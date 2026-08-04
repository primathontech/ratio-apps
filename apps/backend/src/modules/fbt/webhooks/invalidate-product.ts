import type { Transaction } from 'kysely';
import type { FbtDatabase } from '../db/types';

/**
 * Pull a product id out of a webhook payload. Ratio delivers product events in
 * more than one shape depending on topic and environment, so probe the three
 * observed forms rather than assuming one.
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
 * Drop a product's cached vector and any similarity entry sourced from it, so
 * the next sweep recomputes both from current data.
 *
 * Deleting rather than flagging keeps this correct across the model switch: a
 * row is only ever regenerated at the currently configured `embedding_model`.
 *
 * Every statement is scoped by `merchantId` as well as the product id — product
 * ids are only unique within a merchant, so an unscoped delete would purge
 * another merchant's cache.
 *
 * Runs inside the webhook-dispatch transaction, so it writes through `trx` and
 * commits atomically with the `webhook_log` row.
 */
export async function invalidateProduct(
  trx: Transaction<FbtDatabase>,
  merchantId: string,
  productId: string,
): Promise<void> {
  await trx
    .deleteFrom('product_embeddings')
    .where('merchantId', '=', merchantId)
    .where('productId', '=', productId)
    .execute();

  await trx
    .deleteFrom('product_similarity_cache')
    .where('merchantId', '=', merchantId)
    .where('sourceProductId', '=', productId)
    .execute();
}
