import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { QueueService } from '../../../core/queue/queue.service';
import {
  GOOGLE_QUEUE_NAMES,
  type GoogleSyncMessage,
  isSellable,
} from '../gmc/google-product-sync.queue';
import { parseWebhookProduct } from '../gmc/parse-ratio-product';
import { GOOGLE_WEBHOOK_TOPICS } from './topics';

/**
 * `products/update` → enqueue a GMC upsert on the durable SQS queue when the
 * product is still sellable, or a delete when it transitioned to non-sellable
 * (archived/draft/unpublished) so it's removed from GMC. Deferred (R5).
 */
@Injectable()
export class GoogleProductUpdatedHandler implements WebhookHandler {
  readonly topic = GOOGLE_WEBHOOK_TOPICS.productsUpdate;
  private readonly logger = new Logger(GoogleProductUpdatedHandler.name);

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
    const msg: GoogleSyncMessage = isSellable(data)
      ? { op: 'upsert', merchantId, product }
      : { op: 'delete', merchantId, productId: product.id };
    await this.queue.sendBatch(GOOGLE_QUEUE_NAMES.sync, [msg]);
  }
}
