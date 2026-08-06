import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { UnicommerceDatabase } from '../db/types';
import { buildEventLogRow } from '../services/event-log.service';

export const UC_WEBHOOK_TOPICS = {
  productCreate: 'products/create',
  productUpdate: 'products/update',
} as const;

/**
 * Keeps uc_sku_cache fresh incrementally after the initial backfill. This is
 * the ONLY handler registered in Task 4 — Task 1 left `handlerClasses: []`,
 * which createAppProviders rejects; this is what makes the module actually
 * compile end-to-end for the first time.
 *
 * NestJS's WebhooksService only routes by ONE topic per handler instance
 * (see webhooks.types.ts), so productCreate and productUpdate need two
 * registered instances of this same class — see the module wiring in Step 8.
 *
 * IMPORTANT: this handler runs INSIDE the webhook-dispatch transaction (see
 * `WebhooksService.dispatch`). The write goes through `trx` directly (cast to
 * `UnicommerceDatabase`, matching the google module's app-uninstalled handler
 * pattern), NOT through `UcSkuCacheService`'s own module-level DB handle —
 * otherwise the cache write would live in a different transaction from the
 * `webhook_log` row, breaking the all-or-nothing self-healing guarantee.
 * `UcSkuCacheService.upsert()` is still used by `backfill()`, which runs
 * outside any webhook dispatch and has no `trx` available.
 */
@Injectable()
export class UcProductSyncHandler implements WebhookHandler {
  readonly topic: string;
  private readonly logger = new Logger(UcProductSyncHandler.name);

  constructor(topic: string) {
    this.topic = topic;
  }

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'product sync event for unknown merchant — no-op' });
      return;
    }
    const ucTrx = trx as unknown as Transaction<UnicommerceDatabase>;
    const sku = data.sku as string | undefined;
    const variantId = data.id as string | undefined;
    const productId = data.product_id as string | undefined;
    if (!sku || !variantId || !productId) {
      this.logger.warn({
        msg: 'product sync event missing sku/id/product_id — skipped',
        merchantId,
      });
      // Still logged (dashboard visibility, Task 14+ follow-up): a merchant
      // should be able to see that Ratio delivered a products/* webhook even
      // when it was malformed and had nothing usable to act on.
      await ucTrx
        .insertInto('ucEventLogs')
        .values(
          buildEventLogRow({
            merchantId,
            direction: 'inbound',
            flow: 'webhook',
            reference: this.topic,
            result: 'failed',
            payload: data,
            response: 'missing sku/id/product_id — skipped',
          }),
        )
        .execute();
      return;
    }
    await ucTrx
      .insertInto('ucSkuCache')
      .values({ merchantId, sku, ratioVariantId: variantId, ratioProductId: productId })
      .onDuplicateKeyUpdate({ ratioVariantId: variantId, ratioProductId: productId })
      .execute();

    // Was completely invisible on the Sync Activity dashboard before this —
    // a product webhook delivery updated our SKU cache with no visible trace
    // anywhere a merchant/support engineer could look.
    await ucTrx
      .insertInto('ucEventLogs')
      .values(
        buildEventLogRow({
          merchantId,
          direction: 'inbound',
          flow: 'webhook',
          reference: `${this.topic}: ${sku}`,
          result: 'success',
          payload: data,
          response: { ratioVariantId: variantId, ratioProductId: productId },
        }),
      )
      .execute();
  }
}
