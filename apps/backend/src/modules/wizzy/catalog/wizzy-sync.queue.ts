import type { RatioProduct } from './wizzy-transform';

/** Durable SQS queue names for the Wizzy product-sync pipeline. */
export const WIZZY_QUEUE_NAMES = {
  sync: 'wizzy-product-sync',
  dlq: 'wizzy-product-sync-dlq',
} as const;

/**
 * A unit of Wizzy sync work enqueued by the product webhooks.
 *
 * `upsert` carries the `productId`; the worker fetches the authoritative product
 * by id (`GET /products/:id?show_variants=true`) so the payload it transforms is
 * the SAME rich, REST-shaped structure as the full-sync path — not the leaner
 * webhook payload (which omits `collections`/`metafields`, uses `images[].url`
 * instead of `images[].src`, and may send empty `variants`). `product` is an
 * OPTIONAL legacy field for rollover safety: messages enqueued before the
 * fetch-by-id change carried the parsed product, and the worker still honors
 * them for one deploy.
 */
export type WizzySyncMessage =
  | { op: 'upsert'; merchantId: string; productId: string; product?: RatioProduct }
  | { op: 'delete'; merchantId: string; productId: string };

/**
 * Whether a webhook product should be synced to Wizzy.
 *
 * Sellable = `status === 'active'` AND not explicitly unpublished. The webhook
 * payload may carry `published` / `published_at`; when either is present and
 * falsy the product is unpublished. Missing published info means published.
 */
export function isSellable(product: Record<string, unknown>): boolean {
  if (product.status !== 'active') return false;
  if ('published' in product && !product.published) return false;
  if ('published_at' in product && !product.published_at) return false;
  return true;
}
