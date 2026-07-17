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
 * `orders/edited` (address/COD change) → enqueue a `recreate` op. The worker
 * cancels + re-manifests pre-pickup shipments; post-pickup edits are a no-op
 * (the merchant manages those in the Delhivery dashboard).
 */
@Injectable()
export class DelhiveryOrdersEditedHandler implements WebhookHandler {
  readonly topic = DELHIVERY_WEBHOOK_TOPICS.ordersEdited;
  private readonly logger = new Logger(DelhiveryOrdersEditedHandler.name);

  constructor(private readonly queue: QueueService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const rawId = data.id ?? data.order_id;
    const orderId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
    if (!orderId) {
      this.logger.warn({ msg: 'orders/edited without order id — skipped', merchantId });
      return;
    }
    const rawNumber = data.order_number ?? data.orderNumber;
    const msg: DelhiveryShipmentMessage = {
      op: 'recreate',
      merchantId,
      orderId,
      ...(rawNumber != null ? { orderNumber: String(rawNumber) } : {}),
    };
    await this.queue.sendBatch(DELHIVERY_QUEUE_NAMES.shipments, [msg]);
  }
}
