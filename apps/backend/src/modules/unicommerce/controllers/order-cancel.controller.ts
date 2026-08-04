import { Body, Controller, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { UcApiKeyGuard } from '../guards';
import { UcEventLogService } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcOrderItemMapService } from '../services/order-item-map.service';
import { UcRatioApiService } from '../services/uc-ratio-api.service';

const cancelSchema = z.object({
  orderId: z.string(),
  orderItems: z
    .array(
      z.object({
        orderItemId: z.string(),
        productId: z.string(),
        variantId: z.string(),
        quantity: z.number(),
      }),
    )
    .min(1),
});
type CancelRequest = z.infer<typeof cancelSchema>;

@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
export class UcOrderCancelController {
  private readonly logger = new Logger(UcOrderCancelController.name);

  constructor(
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly ratio: UcRatioApiService,
    private readonly eventLog: UcEventLogService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  @Post('orders/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: FastifyRequest & { ucMerchantId: string },
    @Body(new ZodValidationPipe(cancelSchema)) body: CancelRequest,
  ) {
    // TRD §6: accept-and-no-op when disabled — never hard-reject.
    if (!(await this.featureFlags.isEnabled('cancel_sync', req.ucMerchantId))) {
      return {
        status: 'SUCCESS' as const,
        orderItems: body.orderItems.map((i) => ({ orderItemId: i.orderItemId })),
      };
    }
    const results: { orderItemId: string; errorMessage?: string }[] = new Array(
      body.orderItems.length,
    );
    const resolvedByOrder = new Map<
      string,
      { index: number; item: CancelRequest['orderItems'][number] }[]
    >();

    for (const [index, item] of body.orderItems.entries()) {
      const full = await this.orderItemMap.resolveFull(item.orderItemId);
      if (!full || full.merchantId !== req.ucMerchantId) {
        results[index] = { orderItemId: item.orderItemId, errorMessage: 'unknown orderItemId' };
        continue;
      }
      const group = resolvedByOrder.get(full.ratioOrderId) ?? [];
      group.push({ index, item });
      resolvedByOrder.set(full.ratioOrderId, group);
    }

    // TRD §2.7: all items of the order cancelled → whole-order cancel;
    // some items cancelled, others survive → PATCH the order with only the
    // surviving line items. Every item actually cancelled here is tagged
    // uc_originated so the outbound cancel-push loop-prevention check
    // (order-cancelled.handler.ts) knows this cancel already came from UC.
    for (const [ratioOrderId, group] of resolvedByOrder) {
      const cancellingIds = new Set(group.map((g) => g.item.orderItemId));
      const allItems = await this.orderItemMap.findByRatioOrder(req.ucMerchantId, ratioOrderId);
      const survivors = allItems.filter((i) => !cancellingIds.has(i.orderItemId));

      // Never let a downstream failure (Ratio API error, expired OAuth
      // token, network blip) escape as an uncaught exception — degrade to
      // a per-item error for every item in this order group, matching the
      // response shape this endpoint already reports real failures through.
      try {
        if (survivors.length === 0) {
          await this.ratio.cancelOrder(req.ucMerchantId, ratioOrderId);
        } else {
          await this.ratio.updateOrderLineItems(
            req.ucMerchantId,
            ratioOrderId,
            survivors.map((s) => ({ id: s.ratioLineItemId })),
          );
        }
      } catch (err) {
        this.logger.error({
          msg: 'failed to apply cancel to Ratio',
          ratioOrderId,
          err: err instanceof Error ? err.message : String(err),
        });
        for (const { index, item } of group) {
          results[index] = {
            orderItemId: item.orderItemId,
            errorMessage: 'failed to apply update',
          };
        }
        continue;
      }

      for (const { index, item } of group) {
        await this.orderItemMap.markSource(item.orderItemId, 'uc_originated');
        await this.orderItemMap.decrementRemainingQuantity(item.orderItemId, item.quantity);
        await this.orderItemMap.updateLastStatus(
          item.orderItemId,
          'CANCELLED',
          new Date().toISOString(),
        );
        results[index] = { orderItemId: item.orderItemId };
      }
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
        flow: 'cancel',
        reference: body.orderId,
        result: allFailed ? 'failed' : anyFailed ? 'partial' : 'success',
        payload: body,
        response,
      });
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed for orders/cancel',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return response;
  }
}
