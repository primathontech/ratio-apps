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
import { DELHIVERY_WEBHOOK_TOPICS } from './topics';

/**
 * `orders/cancelled` → enqueue a `cancel` op. The worker cancels the AWB when
 * still pre-pickup (`awaiting_pickup`) and marks the shipment
 * `shipment_cancelled` either way. No source guard here — a cancellation must
 * always tear down whatever we manifested.
 *
 * Payload contract (verified against the platform OpenAPI spec): the
 * `order-cancelled` webhook carries ONLY `{ orderId, externalOrderId }`
 * (camelCase, IDs only — NOT the full order). We key on `orderId` first, with
 * snake_case (`order_id`/`external_order_id`) and full-order (`id`) fallbacks
 * so the shipment is found and cancelled regardless of the delivered shape.
 */
@Injectable()
export class DelhiveryOrdersCancelledHandler implements WebhookHandler {
  readonly topic = DELHIVERY_WEBHOOK_TOPICS.ordersCancelled;
  private readonly logger = new Logger(DelhiveryOrdersCancelledHandler.name);

  constructor(private readonly queue: QueueService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const asId = (v: unknown): string =>
      (typeof v === 'string' && v.trim()) || (typeof v === 'number' ? String(v) : '');
    // Real payload: { orderId, externalOrderId }. Fallbacks: snake_case
    // variants, then full-order `id` in case the platform ever sends the order.
    const orderId =
      asId(data.orderId) ||
      asId(data.order_id) ||
      asId(data.id) ||
      asId(data.externalOrderId) ||
      asId(data.external_order_id);
    if (!orderId) {
      this.logger.warn({ msg: 'orders/cancelled without order id — skipped', merchantId });
      return;
    }
    const rawNumber = data.order_number ?? data.orderNumber;
    const msg: DelhiveryShipmentMessage = {
      op: 'cancel',
      merchantId,
      orderId,
      ...(rawNumber != null ? { orderNumber: String(rawNumber) } : {}),
    };
    await this.queue.sendBatch(DELHIVERY_QUEUE_NAMES.shipments, [msg]);
  }
}
