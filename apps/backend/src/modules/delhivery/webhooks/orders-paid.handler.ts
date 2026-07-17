import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import { QueueService } from '../../../core/queue/queue.service';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import {
  DELHIVERY_QUEUE_NAMES,
  type DelhiveryShipmentMessage,
} from '../shipments/shipment-create.queue';
import { DELHIVERY_WEBHOOK_TOPICS, isRatioOrigin } from './topics';

/**
 * `orders/paid` — the ship trigger. The handler never blocks on Delhivery
 * (Ratio's 5s ack budget): it guards `order.source` (Ratio-origin only — the
 * double-shipment guard) and enqueues a `create` op on the durable SQS queue.
 * The worker re-checks `awb_trigger=auto` + the `order_number` idempotency
 * guard against the shipments table, so a duplicate delivery slipping past
 * webhook-log dedupe still can't mint a second AWB.
 */
@Injectable()
export class DelhiveryOrdersPaidHandler implements WebhookHandler {
  readonly topic = DELHIVERY_WEBHOOK_TOPICS.ordersPaid;
  private readonly logger = new Logger(DelhiveryOrdersPaidHandler.name);

  constructor(private readonly queue: QueueService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    // Source guard (TRD §7.4). The verified order payload (platform OpenAPI
    // spec) does NOT carry a `source` field — a hard requirement here would
    // silently no-op every real delivery. So: skip only when `source` is
    // PRESENT and non-Ratio; when absent, the order came through the Ratio
    // webhook pipeline and the worker's own idempotency guards still apply.
    if (data.source != null && !isRatioOrigin(data.source)) {
      this.logger.log({ msg: 'orders/paid from non-Ratio origin — skipped', merchantId, source: data.source });
      return;
    }
    const rawId = data.id ?? data.order_id;
    const orderId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
    if (!orderId) {
      this.logger.warn({ msg: 'orders/paid without order id — skipped', merchantId });
      return;
    }
    const rawNumber = data.order_number ?? data.orderNumber;
    const msg: DelhiveryShipmentMessage = {
      op: 'create',
      merchantId,
      orderId,
      ...(rawNumber != null ? { orderNumber: String(rawNumber) } : {}),
    };
    await this.queue.sendBatch(DELHIVERY_QUEUE_NAMES.shipments, [msg]);
  }
}
