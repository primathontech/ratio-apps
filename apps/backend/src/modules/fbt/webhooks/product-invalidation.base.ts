import type { Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { FbtDatabase } from '../db/types';
import { extractProductId, invalidateProduct } from './invalidate-product';

/**
 * Shared body for the three product topics, which all reduce to the same action:
 * drop this product's cached vector and similarity entry so the next sweep
 * recomputes them from current data.
 *
 * Abstract rather than a single multi-topic handler because `WebhookHandler`
 * exposes exactly one `readonly topic` and `WebhooksService` routes on it — a
 * multi-topic handler would require changing `core/`, which AGENTS.md forbids
 * doing for one vendor.
 *
 * Not @Injectable(): only the concrete subclasses are DI-registered.
 */
export abstract class FbtProductInvalidationHandler implements WebhookHandler {
  abstract readonly topic: string;
  protected abstract readonly logger: Logger;

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'product webhook for unknown merchant — no-op', topic: this.topic });
      return;
    }
    const productId = extractProductId(data);
    if (!productId) {
      this.logger.warn({
        msg: 'product webhook without a product id — no-op',
        topic: this.topic,
        merchantId,
      });
      return;
    }
    await invalidateProduct(trx as unknown as Transaction<FbtDatabase>, merchantId, productId);
    this.logger.log({
      msg: 'product embedding invalidated',
      topic: this.topic,
      merchantId,
      productId,
    });
  }
}
