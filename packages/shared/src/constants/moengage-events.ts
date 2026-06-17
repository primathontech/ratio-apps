import type { OpenStoreEventName } from './openstore-events';

/**
 * Canonical OpenStore → MoEngage event-name map. MoEngage's reporting UI
 * displays event names as-typed, so we use Title Case for readability in the
 * dashboard. Merchants can override any name in the admin event map.
 */
export const DEFAULT_MOENGAGE_EVENT_MAP = {
  PageView: 'Page View',
  ViewContent: 'Product Viewed',
  AddToCart: 'Add To Cart',
  InitiateCheckout: 'Checkout Started',
  AddShippingInfo: 'Shipping Info Submitted',
  AddPaymentInfo: 'Payment Info Submitted',
  Purchase: 'Purchase',
  Search: 'Search',
  AddToWishlist: 'Add To Wishlist',
  Lead: 'Lead',
  CompleteRegistration: 'Registration Completed',
  Contact: 'Contact',
  Subscribe: 'Subscribe',
} as const satisfies Record<OpenStoreEventName, string>;

/**
 * MoEngage data-centre clusters. The `cluster` string is passed to the Web
 * SDK's `moe({ cluster })` init; `dashboard` is the corresponding tenant URL
 * shown in the admin UI as guidance.
 *
 * Source: https://help.moengage.com/hc/en-us/articles/4404674776724
 */
export const MOENGAGE_DATA_CENTERS = {
  DC_1: { label: 'US (DC_1)', dashboard: 'https://dashboard-01.moengage.com' },
  DC_2: { label: 'EU (DC_2)', dashboard: 'https://dashboard-02.moengage.com' },
  DC_3: { label: 'India (DC_3)', dashboard: 'https://dashboard-03.moengage.com' },
  DC_4: { label: 'Indonesia (DC_4)', dashboard: 'https://dashboard-04.moengage.com' },
  DC_5: { label: 'DC_5', dashboard: 'https://dashboard-05.moengage.com' },
} as const;

export type MoEngageDataCenter = keyof typeof MOENGAGE_DATA_CENTERS;
