import { Injectable, Logger } from '@nestjs/common';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import { UcOrderCancelService } from '../services/order-cancel.service';
import { UC_WEBHOOK_TOPICS } from './topics';

type HandlerDb = DatabaseWithMerchants & DatabaseWithWebhookLog;

@Injectable()
export class UcOrderCancelledHandler implements WebhookHandler {
  readonly topic = UC_WEBHOOK_TOPICS.orderCancelled;
  private readonly logger = new Logger(UcOrderCancelledHandler.name);

  constructor(private readonly orderCancel: UcOrderCancelService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    _trx: Transaction<HandlerDb>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn('order.cancelled webhook missing merchantId');
      return;
    }
    const order = data.order as Record<string, unknown> | undefined;
    const orderId = (order?.id ?? data.id) as string | undefined;
    if (!orderId) {
      this.logger.warn({ msg: 'order.cancelled webhook missing order id', merchantId });
      return;
    }

    this.logger.log({ msg: 'handling order.cancelled', merchantId, orderId });
    const result = await this.orderCancel.cancelOrder(merchantId, orderId);
    if (result.manualIntervention) {
      this.logger.warn({ msg: 'manual intervention needed for UC cancellation', merchantId, orderId });
    }
  }
}
