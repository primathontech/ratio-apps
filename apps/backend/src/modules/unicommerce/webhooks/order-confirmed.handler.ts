import { Injectable, Logger } from '@nestjs/common';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import { UcOrderPushService } from '../services/order-push.service';
import { UC_WEBHOOK_TOPICS } from './topics';

type HandlerDb = DatabaseWithMerchants & DatabaseWithWebhookLog;

@Injectable()
export class UcOrderConfirmedHandler implements WebhookHandler {
  readonly topic = UC_WEBHOOK_TOPICS.orderConfirmed;
  private readonly logger = new Logger(UcOrderConfirmedHandler.name);

  constructor(private readonly orderPush: UcOrderPushService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<HandlerDb>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn('order.confirmed webhook missing merchantId');
      return;
    }
    const order = data.order as Record<string, unknown> | undefined;
    const orderId = (order?.id ?? data.id) as string | undefined;
    if (!orderId) {
      this.logger.warn({ msg: 'order.confirmed webhook missing order id', merchantId });
      return;
    }

    this.logger.log({ msg: 'handling order.confirmed', merchantId, orderId });
    await this.orderPush.pushOrderFromWebhook(merchantId, data);
  }
}
