/**
 * Canonical OpenStore event-name vocabulary. Single source of truth — vendor
 * default maps (Template, Template) are keyed by these names via
 * `Record<OpenStoreEventName, string>`, so adding an event here forces every
 * vendor to declare a mapping.
 */
export const OPEN_STORE_EVENT_NAMES = [
  'PageView',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'AddShippingInfo',
  'AddPaymentInfo',
  'Purchase',
  'Search',
  'AddToWishlist',
  'Lead',
  'CompleteRegistration',
  'Contact',
  'Subscribe',
] as const;

export type OpenStoreEventName = (typeof OPEN_STORE_EVENT_NAMES)[number];
