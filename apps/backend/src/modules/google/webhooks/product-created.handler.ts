import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { FeedSyncService } from '../gmc/feed-sync.service';
import { parseRatioProduct } from '../gmc/parse-ratio-product';
import { GOOGLE_WEBHOOK_TOPICS } from './topics';

/**
 * `products/create` → push the new product (+ variants) to GMC.
 *
 * Per TRD R5, the handler does NOT block on the Content API call (Ratio's 5s
 * ack budget): it parses the payload and ENQUEUES the push, which runs after the
 * 200 is returned. The handler itself returns immediately.
 */
@Injectable()
export class GoogleProductCreatedHandler implements WebhookHandler {
  readonly topic = GOOGLE_WEBHOOK_TOPICS.productsCreate;
  private readonly logger = new Logger(GoogleProductCreatedHandler.name);

  constructor(private readonly feedSync: FeedSyncService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const product = parseRatioProduct(data);
    if (!product) {
      this.logger.warn({ msg: 'products/create with unparseable payload — skipped', merchantId });
      return;
    }
    this.feedSync.enqueuePush(merchantId, product, 'webhook');
  }
}
