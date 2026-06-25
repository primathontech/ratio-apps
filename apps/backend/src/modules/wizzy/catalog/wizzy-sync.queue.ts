import type { RatioProduct } from './wizzy-transform';

/** Durable SQS queue names for the Wizzy product-sync pipeline. */
export const WIZZY_QUEUE_NAMES = {
  sync: 'wizzy-product-sync',
  dlq: 'wizzy-product-sync-dlq',
} as const;

/** A unit of Wizzy sync work enqueued by the product webhooks. */
export type WizzySyncMessage =
  | { op: 'upsert'; merchantId: string; product: RatioProduct }
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
