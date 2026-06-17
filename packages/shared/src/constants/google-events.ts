import type { OpenStoreEventName } from './openstore-events';

// The OpenStore → GA4 event-name map. GA4 ingests these PascalCase system event
// names and maps them to GA4's snake_case names internally (see google-pixel.js),
// so the values mirror the keys; the KEYS must stay the full `OpenStoreEventName`
// set (the `satisfies` check enforces it). This map drives the admin's reference
// display — the GA4 event mapping itself is fixed, not merchant-configurable.
/**
 * Canonical OpenStore → GA4 event-name map.
 * Keyed by every `OpenStoreEventName` so a future addition to that union fails
 * the typechecker until this map is updated.
 */
export const DEFAULT_GOOGLE_EVENT_MAP = {
  PageView: 'pageview',
  ViewContent: 'product_viewed',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'checkout_started',
  AddShippingInfo: 'shipping_info_submitted',
  AddPaymentInfo: 'payment_info_submitted',
  Purchase: 'purchase',
  Search: 'search',
  AddToWishlist: 'add_to_wishlist',
  Lead: 'lead',
  CompleteRegistration: 'complete_registration',
  Contact: 'contact',
  Subscribe: 'subscribe',
} as const satisfies Record<OpenStoreEventName, string>;

/**
 * Default event map. The keys (`OpenStoreEventName`s) are the canonical source
 * shared across any vendor; the values are this template's example names.
 *
 * Consumed by:
 *   - schemas/event-map.ts          (drives the Zod schema's required keys)
 *   - apps/google-admin/src/components/EventMapTable.tsx
 *     (drives the placeholder + reset-to-default behaviour)
 */
// Re-export the canonical OpenStore names so vendor consumers (e.g. the admin
// EventMapTable) can import them from this one file. These are ALSO exported by
// `openstore-events`, so under the shared barrel's `export *` the duplicate
// names are elided (not an error); deep imports of `google-events` still resolve
// them. The generic `DEFAULT_EVENT_MAP` alias is intentionally NOT re-exported
// (consumers alias `DEFAULT_GOOGLE_EVENT_MAP` directly).
export { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from './openstore-events';

// Reference host constants retained from the scaffold for any admin display that
// still imports them; the Google config itself has no host field.
/**
 * Default host used to seed a new merchant's `google_configs` row. Named
 * explicitly (rather than `DEFAULT_GOOGLE_HOSTS[0]`) so reordering the
 * known-hosts array doesn't silently change the default for new installs.
 */
export const DEFAULT_GOOGLE_HOST = 'https://us.example.com';

/**
 * Hosts we know about. The admin "Self-hosted" option allows arbitrary https
 * URLs — see the `host` Zod schema in google-config.ts.
 */
export const DEFAULT_GOOGLE_HOSTS = [DEFAULT_GOOGLE_HOST, 'https://eu.example.com'] as const;

export type DefaultGoogleHost = (typeof DEFAULT_GOOGLE_HOSTS)[number];
