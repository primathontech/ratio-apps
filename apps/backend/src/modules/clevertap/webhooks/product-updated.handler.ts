import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { ClevertapCatalogDirtyScheduler } from '../sync/catalog-dirty.scheduler';
import { CLEVERTAP_WEBHOOK_TOPICS } from './topics';

@Injectable()
export class ClevertapProductUpdatedHandler implements WebhookHandler {
  readonly topic = CLEVERTAP_WEBHOOK_TOPICS.productsUpdate;

  constructor(private readonly scheduler: ClevertapCatalogDirtyScheduler) {}

  handle(
    _data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (merchantId) this.scheduler.markDirty(merchantId);
    return Promise.resolve();
  }
}
