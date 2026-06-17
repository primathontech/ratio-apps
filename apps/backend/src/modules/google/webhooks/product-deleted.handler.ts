import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { FeedSyncService } from '../gmc/feed-sync.service';
import { GOOGLE_WEBHOOK_TOPICS } from './topics';

/** `products/delete` → remove the product (+ variants) from GMC. Deferred (R5). */
@Injectable()
export class GoogleProductDeletedHandler implements WebhookHandler {
  readonly topic = GOOGLE_WEBHOOK_TOPICS.productsDelete;
  private readonly logger = new Logger(GoogleProductDeletedHandler.name);

  constructor(private readonly feedSync: FeedSyncService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) return;
    const raw = (typeof data.product === 'object' && data.product ? data.product : data) as Record<
      string,
      unknown
    >;
    const productId = typeof raw.id === 'string' ? raw.id : null;
    if (!productId) {
      this.logger.warn({ msg: 'products/delete with no product id — skipped', merchantId });
      return;
    }
    this.feedSync.enqueueDelete(merchantId, productId);
  }
}
