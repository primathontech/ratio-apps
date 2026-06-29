import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import { QueueService } from '../../../core/queue/queue.service';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { WIZZY_QUEUE_NAMES, type WizzySyncMessage } from '../catalog/wizzy-sync.queue';
import { WIZZY_WEBHOOK_TOPICS } from './topics';

/** `products/delete` → enqueue a Wizzy delete on the durable SQS queue. */
@Injectable()
export class WizzyProductDeletedHandler implements WebhookHandler {
  readonly topic = WIZZY_WEBHOOK_TOPICS.productsDelete;
  private readonly logger = new Logger(WizzyProductDeletedHandler.name);

  constructor(private readonly queue: QueueService) {}

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
    const msg: WizzySyncMessage = { op: 'delete', merchantId, productId };
    await this.queue.sendBatch(WIZZY_QUEUE_NAMES.sync, [msg]);
  }
}
