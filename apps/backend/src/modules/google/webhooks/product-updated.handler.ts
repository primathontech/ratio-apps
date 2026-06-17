import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { FeedSyncService } from '../gmc/feed-sync.service';
import { parseRatioProduct } from '../gmc/parse-ratio-product';
import { GOOGLE_WEBHOOK_TOPICS } from './topics';

/** `products/update` → re-push the product to GMC (insert is upsert). Deferred (R5). */
@Injectable()
export class GoogleProductUpdatedHandler implements WebhookHandler {
  readonly topic = GOOGLE_WEBHOOK_TOPICS.productsUpdate;
  private readonly logger = new Logger(GoogleProductUpdatedHandler.name);

  constructor(private readonly feedSync: FeedSyncService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const product = parseRatioProduct(data);
    if (!product) {
      this.logger.warn({ msg: 'products/update with unparseable payload — skipped', merchantId });
      return;
    }
    this.feedSync.enqueuePush(merchantId, product, 'webhook');
  }
}
