import type { Transaction } from 'kysely';
import type { FbtDatabase } from '../db/types';

/**
 * Pull a product id out of a webhook payload. `WebhooksService.dispatch` passes the
 * unwrapped resource, so `data.id` is the usual hit; the other two forms are defensive
 * because Ratio delivers product events in more than one shape across environments.
 */
export function extractProductId(data: Record<string, unknown>): string | null {
  const nested = data.product;
  const candidates: unknown[] = [
    data.product_id,
    data.id,
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>).id : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

/**
 * Drop a product's cached vector and any similarity entry sourced from it, so the next
 * sweep recomputes both from current data. Without this, an edited product keeps a stale
 * embedding until the staleness check happens to catch it.
 *
 * Every statement is scoped by `merchantId` as well as the product id — product ids are
 * only unique within a merchant, so an unscoped delete would purge another merchant's
 * cache. One of the tests asserts exactly this.
 *
 * Runs inside the webhook-dispatch transaction, so it writes through `trx` and commits
 * atomically with the `webhook_log` row.
 */
export async function invalidateProduct(
  trx: Transaction<FbtDatabase>,
  merchantId: string,
  productId: string,
): Promise<void> {
  await trx
    .deleteFrom('fbt_product_embeddings')
    .where('merchantId', '=', merchantId)
    .where('productId', '=', productId)
    .execute();

  await trx
    .deleteFrom('fbt_similarity_cache')
    .where('merchantId', '=', merchantId)
    .where('sourceProductId', '=', productId)
    .execute();
}
