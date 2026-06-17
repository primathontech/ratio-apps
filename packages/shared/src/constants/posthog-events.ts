import type { OpenStoreEventName } from './openstore-events';

/**
 * Canonical OpenStore → PostHog event-name map.
 * Keyed by every `OpenStoreEventName` so a future addition to that union fails
 * the typechecker until this map is updated.
 */
export const DEFAULT_POSTHOG_EVENT_MAP = {
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

// Re-export for back-compat — old consumers imported these from posthog-events.
export { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from './openstore-events';

/**
 * Default PostHog host used to seed a new merchant's `posthog_configs` row.
 * Named explicitly (rather than `DEFAULT_POSTHOG_HOSTS[0]`) so reordering the
 * known-hosts array — e.g. listing EU first — doesn't silently change the
 * default for new installs.
 */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/**
 * PostHog hosts we know about. The admin "Self-hosted" option allows arbitrary
 * https URLs — see the `host` Zod schema in posthog-config.ts.
 */
export const DEFAULT_POSTHOG_HOSTS = [DEFAULT_POSTHOG_HOST, 'https://eu.i.posthog.com'] as const;

export type DefaultPosthogHost = (typeof DEFAULT_POSTHOG_HOSTS)[number];
