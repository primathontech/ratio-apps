import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import { QueueService } from '../../../core/queue/queue.service';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { parseWebhookProduct } from '../catalog/parse-ratio-product';
import { isSellable, WIZZY_QUEUE_NAMES, type WizzySyncMessage } from '../catalog/wizzy-sync.queue';
import { WIZZY_WEBHOOK_TOPICS } from './topics';

/**
 * `products/update` → enqueue a Wizzy upsert when the product is still
 * sellable, or a delete when it transitioned to non-sellable.
 */
@Injectable()
export class WizzyProductUpdatedHandler implements WebhookHandler {
  readonly topic = WIZZY_WEBHOOK_TOPICS.productsUpdate;
  private readonly logger = new Logger(WizzyProductUpdatedHandler.name);

  constructor(private readonly queue: QueueService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const product = parseWebhookProduct(data);
    if (!product) {
      this.logger.warn({ msg: 'products/update with unparseable payload — skipped', merchantId });
      return;
    }
    const msg: WizzySyncMessage = isSellable(data)
      ? { op: 'upsert', merchantId, product }
      : { op: 'delete', merchantId, productId: product.id };
    await this.queue.sendBatch(WIZZY_QUEUE_NAMES.sync, [msg]);
  }
}
