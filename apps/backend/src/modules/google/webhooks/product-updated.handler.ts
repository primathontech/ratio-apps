import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { QueueService } from '../../../core/queue/queue.service';
import { GOOGLE_QUEUE_NAMES, type GoogleSyncMessage } from '../gmc/google-product-sync.queue';
import { parseWebhookProduct } from '../gmc/parse-ratio-product';
import { GOOGLE_WEBHOOK_TOPICS } from './topics';

/**
 * `products/update` → enqueue a GMC upsert (by id) on the durable SQS queue. The
 * worker fetches the authoritative product and decides sync-vs-remove: an
 * archived/draft/unpublished product is removed from GMC (if it was synced). The
 * publish/active gate is NOT applied here — webhook payloads can't be trusted
 * for publish state. Deferred (R5).
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
    const msg: GoogleSyncMessage = { op: 'upsert', merchantId, productId: product.id };
    await this.queue.sendBatch(GOOGLE_QUEUE_NAMES.sync, [msg]);
  }
}
