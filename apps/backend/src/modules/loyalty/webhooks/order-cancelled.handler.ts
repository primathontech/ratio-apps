import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { normalizePhone } from '../common/normalize-phone';
import type { LoyaltyDatabase } from '../db/types';
import { CustomerMirrorService } from '../mirror/customer-mirror.service';
import { LOYALTY_WEBHOOK_TOPICS } from './topics';

/**
 * `orders/cancelled` — correct the customer mirror only. Spend/orders
 * decrement floored at 0; an unknown phone matches zero rows. There is NO
 * coin clawback (TRD §4) — earned coins stay earned.
 *
 * Runs inside the webhook-dispatch transaction: writes go through `trx` so
 * the mirror correction commits (or rolls back) with the `webhook_log` row.
 */
@Injectable()
export class LoyaltyOrderCancelledHandler implements WebhookHandler {
  readonly topic = LOYALTY_WEBHOOK_TOPICS.ordersCancelled;
  private readonly logger = new Logger(LoyaltyOrderCancelledHandler.name);

  constructor(private readonly mirror: CustomerMirrorService) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'orders/cancelled for unknown merchant — no-op' });
      return;
    }

    const customer = (data.customer ?? {}) as Record<string, unknown>;
    const rawPhone = typeof customer.phone === 'string' ? customer.phone : '';
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!phone) {
      this.logger.warn({
        msg: 'orders/cancelled without a usable phone — skipping mirror correction',
        merchantId,
      });
      return;
    }

    const rawTotal = data.total_price;
    const orderTotal =
      typeof rawTotal === 'number'
        ? rawTotal
        : typeof rawTotal === 'string' && rawTotal.trim() !== '' && !Number.isNaN(Number(rawTotal))
          ? Number(rawTotal)
          : 0;

    const ltrx = trx as unknown as Transaction<LoyaltyDatabase>;
    await this.mirror.decrementForCancelledOrder(ltrx, merchantId, phone, orderTotal);
  }
}
