import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { UnicommerceDatabase } from '../db/types';
import { buildEventLogRow } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcOrderItemMapService } from '../services/order-item-map.service';
import { UcSyncQueueService } from '../services/sync-queue.service';
import { UC_ORDER_WEBHOOK_TOPICS } from './order-confirmed.handler';

@Injectable()
export class UcOrderCancelledHandler implements WebhookHandler {
  readonly topic = UC_ORDER_WEBHOOK_TOPICS.orderCancelled;
  private readonly logger = new Logger(UcOrderCancelledHandler.name);

  constructor(
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly syncQueue: UcSyncQueueService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'orders/cancelled for unknown merchant — no-op' });
      return;
    }
    const ucTrx = trx as unknown as Transaction<UnicommerceDatabase>;
    const orderId = data.id as string;

    // Race: `orders/create` enqueues an order_push job, then the customer
    // cancels before a worker ever consumes it. `findSaleOrderCode` below
    // only sees a DONE push, so a still-PENDING/RETRYING/NEEDS_MANUAL job
    // would otherwise run anyway and ship an order that was already
    // cancelled. Neutralize it unconditionally, up front — a no-op if no
    // such job exists or it's already DONE/IN_PROGRESS.
    await this.syncQueue.cancelPendingOrderPush(merchantId, orderId);

    const orderItems = await this.orderItemMap.findByRatioOrder(merchantId, orderId);
    const allUcOriginated =
      orderItems.length > 0 && orderItems.every((i) => i.source === 'uc_originated');
    if (allUcOriginated) {
      this.logger.log({
        msg: 'cancel for UC-originated order — suppressing outbound push to prevent loop',
        merchantId,
        orderId,
      });
      await ucTrx
        .insertInto('ucEventLogs')
        .values(
          buildEventLogRow({
            merchantId,
            direction: 'inbound',
            flow: 'webhook',
            reference: `${this.topic}: ${orderId}`,
            result: 'success',
            payload: data,
            response: 'suppressed — UC-originated order, no outbound push needed',
          }),
        )
        .execute();
      return;
    }

    const saleOrderCode = await this.orderItemMap.findSaleOrderCode(merchantId, orderId);
    if (!saleOrderCode) {
      this.logger.log({
        msg: 'cancel for an order never pushed to UC — no-op',
        merchantId,
        orderId,
      });
      await ucTrx
        .insertInto('ucEventLogs')
        .values(
          buildEventLogRow({
            merchantId,
            direction: 'inbound',
            flow: 'webhook',
            reference: `${this.topic}: ${orderId}`,
            result: 'success',
            payload: data,
            response: 'no successful prior push on file — nothing to cancel',
          }),
        )
        .execute();
      return;
    }

    // TRD §6: earliest gate before the outbound cancel-push job is created —
    // the loop-prevention checks above still run regardless (they're
    // decisions about whether this cancel is worth acting on at all, not
    // the outbound push itself).
    if (!(await this.featureFlags.isEnabled('cancel_sync', merchantId))) {
      this.logger.log({
        msg: 'cancel_sync flag disabled — skipping outbound cancel push',
        merchantId,
        orderId,
      });
      await ucTrx
        .insertInto('ucEventLogs')
        .values(
          buildEventLogRow({
            merchantId,
            direction: 'inbound',
            flow: 'webhook',
            reference: `${this.topic}: ${orderId}`,
            result: 'success',
            payload: data,
            response: 'cancel_sync flag disabled — outbound cancel push skipped',
          }),
        )
        .execute();
      return;
    }

    const jobId = randomUUID();
    const payloadJson = JSON.stringify({
      merchantId,
      ratioOrderId: orderId,
      saleOrderCode,
      reason: 'Cancelled on Ratio storefront',
    });
    await ucTrx
      .insertInto('ucSyncJobs')
      .values({
        id: jobId,
        merchantId,
        type: 'cancel_push',
        ratioOrderId: orderId,
        payload: payloadJson as unknown as Record<string, unknown>,
        status: 'PENDING',
      })
      .execute();

    await ucTrx
      .insertInto('ucEventLogs')
      .values(
        buildEventLogRow({
          merchantId,
          direction: 'inbound',
          flow: 'webhook',
          reference: `${this.topic}: ${orderId}`,
          result: 'success',
          payload: data,
          response: { queuedJobId: jobId },
        }),
      )
      .execute();

    this.syncQueue
      .publish(jobId, { merchantId, type: 'cancel_push', ratioOrderId: orderId })
      .catch((err: unknown) => {
        this.logger.warn({
          msg: 'Kafka publish failed after enqueue; job is PENDING in DB',
          jobId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
