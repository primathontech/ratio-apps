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
    // Real envelope shape (confirmed live 2026-08-06 against the platform
    // API): the product id sits at the top level, and each variant's own id
    // + sku sit nested under `variants[]` — there is no top-level
    // `sku`/`product_id` on the envelope itself.
    const productId = data.id as string | undefined;
    const variants = (data.variants as Array<{ id?: string; sku?: string }> | undefined) ?? [];
    if (!productId || variants.length === 0) {
      this.logger.warn({
        msg: 'product sync event missing id/variants — skipped',
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
            response: 'missing id/variants — skipped',
          }),
        )
        .execute();
      return;
    }

    const upserted: Array<{ sku: string; ratioVariantId: string }> = [];
    for (const variant of variants) {
      if (!variant.sku || !variant.id) continue;
      await ucTrx
        .insertInto('ucSkuCache')
        .values({
          merchantId,
          sku: variant.sku,
          ratioVariantId: variant.id,
          ratioProductId: productId,
        })
        .onDuplicateKeyUpdate({ ratioVariantId: variant.id, ratioProductId: productId })
        .execute();
      upserted.push({ sku: variant.sku, ratioVariantId: variant.id });
    }

    // Was completely invisible on the Sync Activity dashboard before this —
    // a product webhook delivery updated our SKU cache with no visible trace
    // anywhere a merchant/support engineer could look. One row per product
    // event (not per variant) — a product can carry many variants.
    await ucTrx
      .insertInto('ucEventLogs')
      .values(
        buildEventLogRow({
          merchantId,
          direction: 'inbound',
          flow: 'webhook',
          reference: `${this.topic}: ${productId}`,
          result: 'success',
          payload: data,
          response: { upserted },
        }),
      )
      .execute();
  }
}
