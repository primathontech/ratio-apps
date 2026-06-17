import type { OpenStoreEventName } from './openstore-events';

/**
 * OpenStore → Meta event-name map. Meta's standard events use the SAME
 * PascalCase names as OpenStore, so this is an identity map. Keyed by every
 * `OpenStoreEventName` so adding an OS event forces a mapping here.
 */
export const DEFAULT_META_EVENT_MAP = {
  PageView: 'PageView',
  ViewContent: 'ViewContent',
  AddToCart: 'AddToCart',
  InitiateCheckout: 'InitiateCheckout',
  AddShippingInfo: 'AddShippingInfo',
  AddPaymentInfo: 'AddPaymentInfo',
  Purchase: 'Purchase',
  Search: 'Search',
  AddToWishlist: 'AddToWishlist',
  Lead: 'Lead',
  CompleteRegistration: 'CompleteRegistration',
  Contact: 'Contact',
  Subscribe: 'Subscribe',
} as const satisfies Record<OpenStoreEventName, string>;

// The generic `DEFAULT_EVENT_MAP` alias is intentionally NOT re-exported here
// (consumers import `DEFAULT_META_EVENT_MAP` directly). This keeps the unified
// shared barrel collision-free when both `_template-events` and `meta-events`
// are exported together.
export { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from './openstore-events';

/**
 * Data-sharing levels (match Shopify's Facebook & Instagram app).
 *   standard  — Pixel only (no CAPI)
 *   enhanced  — Pixel + CAPI for Purchase only
 *   maximum   — Pixel + CAPI for all events + full PII   (recommended default)
 */
export const DATA_SHARING_LEVELS = ['standard', 'enhanced', 'maximum'] as const;
export type DataSharingLevel = (typeof DATA_SHARING_LEVELS)[number];
export const DEFAULT_DATA_SHARING_LEVEL: DataSharingLevel = 'maximum';

/**
 * Which product identifier is sent in `content_ids` — must match the catalog
 * feed `id` and the merchant's Meta Ads "Product Identifier" setting, or
 * Dynamic Product Ads break.
 */
export const PRODUCT_ID_TYPES = ['product_id', 'sku', 'variant_id'] as const;
export type ProductIdType = (typeof PRODUCT_ID_TYPES)[number];
export const DEFAULT_PRODUCT_ID_TYPE: ProductIdType = 'product_id';
