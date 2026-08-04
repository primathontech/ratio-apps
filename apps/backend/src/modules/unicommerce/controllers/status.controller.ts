import { Body, Controller, HttpCode, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { UcApiKeyGuard } from '../guards';
import { UcCredentialsService } from '../services/credentials.service';
import { UcEventLogService } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcOrderItemMapService } from '../services/order-item-map.service';
import { UcRatioApiService } from '../services/uc-ratio-api.service';
import { UcStatusMappingService } from '../services/status-mapping.service';

const statusSchema = z.object({
  // `IsReverse` — capital I — confirmed directly against
  // post_status_notification.html. Not a documentation nuance: the field
  // UC actually sends never matches a lowercase `isReverse` key.
  orderItems: z
    .array(
      z.object({
        orderItemId: z.string(),
        status: z.string(),
        IsReverse: z.boolean(),
        updated: z.string(),
      }),
    )
    .min(1),
});
type StatusRequest = z.infer<typeof statusSchema>;

@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
export class UcStatusController {
  private readonly logger = new Logger(UcStatusController.name);

  constructor(
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly statusMapping: UcStatusMappingService,
    private readonly ratio: UcRatioApiService,
    private readonly eventLog: UcEventLogService,
    private readonly credentials: UcCredentialsService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  @Post('order/:orderId')
  @HttpCode(200)
  async notify(
    @Param('orderId') orderId: string,
    @Req() req: FastifyRequest & { ucMerchantId: string },
    @Body(new ZodValidationPipe(statusSchema)) body: StatusRequest,
  ) {
    // TRD §6: accept-and-no-op when disabled — never hard-reject. The
    // notification-received signal still counts (§5 Signal B proof-of-life)
    // even though we skip applying anything to Ratio.
    if (!(await this.featureFlags.isEnabled('dispatch_status_sync', req.ucMerchantId))) {
      this.credentials.touchStatusNotification(req.ucMerchantId).catch(() => {});
      return {
        status: 'SUCCESS' as const,
        orderItems: body.orderItems.map((i) => ({ orderItemId: i.orderItemId })),
      };
    }
    const results: { orderItemId: string; errorMessage?: string }[] = [];

    for (const item of body.orderItems) {
      const full = await this.orderItemMap.resolveFull(item.orderItemId);
      if (!full || full.merchantId !== req.ucMerchantId) {
        results.push({ orderItemId: item.orderItemId, errorMessage: 'unknown orderItemId' });
        continue;
      }

      if (full.lastStatusUpdatedAt) {
        const incoming = new Date(item.updated).getTime();
        const stored = new Date(full.lastStatusUpdatedAt).getTime();
        if (incoming <= stored && full.lastStatus === item.status) {
          results.push({ orderItemId: item.orderItemId, errorMessage: 'no_change' });
          continue;
        }
      }

      let mapped: ReturnType<typeof this.statusMapping.map>;
      try {
        mapped = this.statusMapping.map(item.status, item.IsReverse);
      } catch (err) {
        this.logger.warn({
          msg: 'unrecognized Unicommerce status',
          orderItemId: item.orderItemId,
          status: item.status,
          isReverse: item.IsReverse,
          err: err instanceof Error ? err.message : String(err),
        });
        results.push({ orderItemId: item.orderItemId, errorMessage: 'unrecognized status' });
        continue;
      }
      // Never let a downstream failure (Ratio API error, expired OAuth
      // token, network blip) escape as an uncaught exception — this
      // endpoint must ALWAYS return the SUCCESS shape (see below), and an
      // unhandled 500 here would violate that just as badly as returning a
      // FAILED status would.
      try {
        if (mapped !== 'no_change') {
          await this.ratio.updateOrderStatus(req.ucMerchantId, full.ratioOrderId, mapped);
        }
        await this.orderItemMap.updateLastStatus(item.orderItemId, item.status, item.updated);
        results.push({ orderItemId: item.orderItemId });
      } catch (err) {
        this.logger.error({
          msg: 'failed to apply status update to Ratio',
          orderItemId: item.orderItemId,
          err: err instanceof Error ? err.message : String(err),
        });
        results.push({ orderItemId: item.orderItemId, errorMessage: 'failed to apply update' });
      }
    }

    this.credentials.touchStatusNotification(req.ucMerchantId).catch(() => {});

    const anyFailed = results.some((r) => r.errorMessage && r.errorMessage !== 'no_change');
    const allFailed = results.every((r) => r.errorMessage);
    // Confirmed directly by Unicommerce's team: this endpoint must ALWAYS
    // return the success shape, regardless of internal outcome. Returning
    // anything else means UC stops sending any further status notifications
    // for that order at all, until the merchant manually retries inside
    // Unicommerce — worse than a single lost update. Per-item failures still
    // go into `orderItems[].errorMessage` (that's the real, useful signal);
    // only the top-level `status` is pinned to SUCCESS. Real failures are
    // still fully captured for our own ops via the event-log write below.
    const response = {
      status: 'SUCCESS' as const,
      orderItems: results,
    };
    try {
      await this.eventLog.record({
        merchantId: req.ucMerchantId,
        direction: 'inbound',
        flow: 'status',
        reference: orderId,
        result: allFailed ? 'failed' : anyFailed ? 'partial' : 'success',
        payload: body,
        response,
      });
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed for order status notify',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return response;
  }
}
