import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { ClevertapForwardingService } from '../events/forwarding.service';
import { CLEVERTAP_WEBHOOK_TOPICS } from './topics';

@Injectable()
export class ClevertapOrderCreatedHandler implements WebhookHandler {
  readonly topic = CLEVERTAP_WEBHOOK_TOPICS.ordersCreate;

  constructor(private readonly forwarding: ClevertapForwardingService) {}

  handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    return this.forwarding.forwardOrder(this.topic, data, merchantId, trx);
  }
}
