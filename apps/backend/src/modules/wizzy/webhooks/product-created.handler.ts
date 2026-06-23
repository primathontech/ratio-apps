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
 * `products/create` → enqueue a Wizzy upsert on the durable SQS queue.
 *
 * Parses + enqueues; a separate worker drains the queue. Non-sellable creates
 * are dropped (a brand-new draft isn't in Wizzy yet so no delete needed).
 */
@Injectable()
export class WizzyProductCreatedHandler implements WebhookHandler {
  readonly topic = WIZZY_WEBHOOK_TOPICS.productsCreate;
  private readonly logger = new Logger(WizzyProductCreatedHandler.name);

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
    if (!isSellable(data)) return;
    const msg: WizzySyncMessage = { op: 'upsert', merchantId, product };
    await this.queue.sendBatch(WIZZY_QUEUE_NAMES.sync, [msg]);
  }
}
