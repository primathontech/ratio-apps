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
 * `products/create` → enqueue a GMC upsert (by id) on the durable SQS queue.
 *
 * Per TRD R5 the handler never blocks on the Content API (Ratio's 5s ack
 * budget): it validates the payload, enqueues the product id, and the worker
 * fetches the authoritative product + decides sync-vs-remove. The publish/active
 * gate is NOT applied here — webhook payloads don't reliably carry publish state.
 */
@Injectable()
export class GoogleProductCreatedHandler implements WebhookHandler {
  readonly topic = GOOGLE_WEBHOOK_TOPICS.productsCreate;
  private readonly logger = new Logger(GoogleProductCreatedHandler.name);

  constructor(private readonly queue: QueueService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const product = parseWebhookProduct(data);
    if (!product) {
      this.logger.warn({ msg: 'products/create with unparseable payload — skipped', merchantId });
      return;
    }
    const msg: GoogleSyncMessage = { op: 'upsert', merchantId, productId: product.id };
    await this.queue.sendBatch(GOOGLE_QUEUE_NAMES.sync, [msg]);
  }
}
