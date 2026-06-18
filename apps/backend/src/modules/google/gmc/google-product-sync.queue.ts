import type { RatioProduct } from './product-mapper';

/** Durable SQS queue names for the GMC product-sync pipeline. */
export const GOOGLE_QUEUE_NAMES = {
  sync: 'google-product-sync',
  dlq: 'google-product-sync-dlq',
} as const;

/** A unit of GMC sync work enqueued by the product webhooks. */
export type GoogleSyncMessage =
  | { op: 'upsert'; merchantId: string; product: RatioProduct }
  | { op: 'delete'; merchantId: string; productId: string };

/**
 * Whether a webhook product should live in GMC.
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
