import type { OpenStoreEventName } from './openstore-events';

// TEMPLATE: This is the example OpenStore -> vendor event-name map. Replace the
// values with the event names your vendor expects. The KEYS must stay the full
// `OpenStoreEventName` set (the `satisfies` check enforces it).
/**
 * Canonical OpenStore → vendor event-name map (example).
 * Keyed by every `OpenStoreEventName` so a future addition to that union fails
 * the typechecker until this map is updated.
 */
export const DEFAULT_TEMPLATE_EVENT_MAP = {
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
 *   - apps/_template-admin/src/components/EventMapTable.tsx
 *     (drives the placeholder + reset-to-default behaviour)
 */
export const DEFAULT_EVENT_MAP = DEFAULT_TEMPLATE_EVENT_MAP;

// Re-export for convenience — consumers import these from _template-events.
export { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from './openstore-events';

// TEMPLATE: Replace these example hosts with your vendor's ingestion endpoints,
// or delete them if your vendor config doesn't need a host field.
/**
 * Default host used to seed a new merchant's `_template_configs` row. Named
 * explicitly (rather than `DEFAULT_TEMPLATE_HOSTS[0]`) so reordering the
 * known-hosts array doesn't silently change the default for new installs.
 */
export const DEFAULT_TEMPLATE_HOST = 'https://us.example.com';

/**
 * Hosts we know about. The admin "Self-hosted" option allows arbitrary https
 * URLs — see the `host` Zod schema in _template-config.ts.
 */
export const DEFAULT_TEMPLATE_HOSTS = [DEFAULT_TEMPLATE_HOST, 'https://eu.example.com'] as const;

export type DefaultTemplateHost = (typeof DEFAULT_TEMPLATE_HOSTS)[number];
