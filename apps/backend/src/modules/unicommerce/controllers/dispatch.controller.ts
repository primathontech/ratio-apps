import { Body, Controller, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { UcApiKeyGuard } from '../guards';
import { UcEventLogService } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcOrderItemMapService } from '../services/order-item-map.service';
import { UcRatioApiService } from '../services/uc-ratio-api.service';

export const dispatchSchema = z.object({
  // TRD §2.6, confirmed directly against post-orders-dispatch.html: there is
  // no single `gstPercentage` field — UC sends `quantity` plus up to 6
  // separate tax fields, each "as applied" (so optional — not every order
  // has all of them).
  orderItems: z
    .array(
      z.object({
        orderItemId: z.string(),
        quantity: z.number().optional().default(1),
        taxRate: z.number().optional(),
        centralGstPercentage: z.number().optional(),
        stateGstPercentage: z.number().optional(),
        unionTerritoryGstPercentage: z.number().optional(),
        integratedGstPercentage: z.number().optional(),
        compensationCessPercentage: z.number().optional(),
      }),
    )
    .min(1),
  selfShipping: z.object({
    deliveryPartner: z.string(),
    deliveryCourier: z.string(),
    dispatchDate: z.string(),
    invoiceNumber: z.string(),
    invoiceDate: z.string(),
    trackingId: z.string(),
    trackingURL: z.string(),
    tentativeDeliveryDate: z.string(),
  }),
});
type DispatchRequest = z.infer<typeof dispatchSchema>;

@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
export class UcDispatchController {
  private readonly logger = new Logger(UcDispatchController.name);

  constructor(
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly ratio: UcRatioApiService,
    private readonly eventLog: UcEventLogService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) { }

  @Post('orders/dispatch')
  @HttpCode(200)
  async dispatch(
    @Req() req: FastifyRequest & { ucMerchantId: string },
    @Body(new ZodValidationPipe(dispatchSchema)) body: DispatchRequest,
  ) {
    // TRD §6: accept-and-no-op when disabled — never hard-reject.
    if (!(await this.featureFlags.isEnabled('dispatch_status_sync', req.ucMerchantId))) {
      return {
        status: 'SUCCESS' as const,
        orderItems: body.orderItems.map((i) => ({ orderItemId: i.orderItemId })),
      };
    }
    const results: { orderItemId: string; errorMessage?: string }[] = [];
    const updatedOrderIds = new Set<string>();

    const metafields = [
      {
        namespace: 'unicommerce',
        key: 'tracking_number',
        value: body.selfShipping.trackingId,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'courier',
        value: body.selfShipping.deliveryCourier,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'invoice_number',
        value: body.selfShipping.invoiceNumber,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'invoice_date',
        value: body.selfShipping.invoiceDate,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'tracking_url',
        value: body.selfShipping.trackingURL,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'tentative_delivery_date',
        value: body.selfShipping.tentativeDeliveryDate,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'dispatch_date',
        value: body.selfShipping.dispatchDate,
        type: 'string',
      },
      {
        namespace: 'unicommerce',
        key: 'delivery_partner',
        value: body.selfShipping.deliveryPartner,
        type: 'string',
      },
    ];

    // Pre-resolve all items to compute accurate total dispatched quantities
    const resolvedItemsMap = new Map();
    for (const item of body.orderItems) {
      const full = await this.orderItemMap.resolveFull(item.orderItemId);
      resolvedItemsMap.set(item.orderItemId, full);
    }

    for (const item of body.orderItems) {
      const full = resolvedItemsMap.get(item.orderItemId);
      if (!full || full.merchantId !== req.ucMerchantId) {
        results.push({ orderItemId: item.orderItemId, errorMessage: 'unknown orderItemId' });
        continue;
      }

      const qty = item.quantity ?? 1;
      if (full.remainingQuantity < qty) {
        results.push({
          orderItemId: item.orderItemId,
          errorMessage: 'remaining quantity insufficient',
        });
        continue;
      }

      if (!updatedOrderIds.has(full.ratioOrderId)) {
        let fulfillmentStatus = 'fulfilled';
        const siblings = await this.orderItemMap.findByRatioOrder(
          req.ucMerchantId,
          full.ratioOrderId,
        );
        const totalRemaining = siblings.reduce((s, r) => s + r.remainingQuantity, 0);

        // Sum what is genuinely being dispatched for this order in this payload
        const totalDispatched = body.orderItems.reduce((sum, i) => {
          const matchingFull = resolvedItemsMap.get(i.orderItemId);
          if (matchingFull && matchingFull.ratioOrderId === full.ratioOrderId) {
            // Only count if it will pass the quantity check
            const iQty = i.quantity ?? 1;
            if (matchingFull.remainingQuantity >= iQty) {
              return sum + iQty;
            }
          }
          return sum;
        }, 0);

        if (totalRemaining > totalDispatched) {
          fulfillmentStatus = 'partially_fulfilled';
        }

        // Never let a downstream failure (Ratio API error, expired OAuth
        // token, network blip) escape as an uncaught exception — degrade to
        // a per-item error, matching the response shape this endpoint
        // already reports real per-item failures through.
        try {
          await this.ratio.updateOrderFulfillment(req.ucMerchantId, full.ratioOrderId, {
            fulfillment_status: fulfillmentStatus,
            metafields,
          });
          updatedOrderIds.add(full.ratioOrderId);
        } catch (err) {
          this.logger.error({
            msg: 'failed to apply fulfillment update to Ratio',
            orderItemId: item.orderItemId,
            ratioOrderId: full.ratioOrderId,
            err: err instanceof Error ? err.message : String(err),
          });
          results.push({ orderItemId: item.orderItemId, errorMessage: 'failed to apply update' });
          continue;
        }
      }

      await this.orderItemMap.decrementRemainingQuantity(item.orderItemId, qty);
      results.push({ orderItemId: item.orderItemId });
    }

    const anyFailed = results.some((r) => r.errorMessage);
    const allFailed = results.every((r) => r.errorMessage);
    const response = {
      status: allFailed ? 'FAILED' : anyFailed ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      orderItems: results,
    };
    try {
      await this.eventLog.record({
        merchantId: req.ucMerchantId,
        direction: 'inbound',
        flow: 'dispatch',
        reference: body.orderItems.map((i) => i.orderItemId).join(','),
        result: allFailed ? 'failed' : anyFailed ? 'partial' : 'success',
        payload: body,
        response,
      });
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed for orders/dispatch',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return response;
  }
}
