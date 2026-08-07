import type { OpenStoreEventName } from './openstore-events';

export const DEFAULT_CLEVERTAP_EVENT_MAP = {
  PageView: 'Page Browse',
  ViewContent: 'Product Viewed',
  AddToCart: 'Added to Cart',
  InitiateCheckout: 'Checkout Initiated',
  AddShippingInfo: 'Shipping Info Submitted',
  AddPaymentInfo: 'Payment Info Submitted',
  Purchase: 'Charged',
  Search: 'Search',
  AddToWishlist: 'Add to Wishlist',
  Lead: 'Lead',
  CompleteRegistration: 'Registration Completed',
  Contact: 'Contact',
  Subscribe: 'Subscribe',
} as const satisfies Record<OpenStoreEventName, string>;

export const CLEVERTAP_CHARGED_EVENT = 'Charged';

export const CLEVERTAP_WEBHOOK_EVENT_NAMES = {
  'orders/paid': CLEVERTAP_CHARGED_EVENT,
  'orders/create': 'Order Created',
  'orders/cancelled': 'Order Cancelled',
  'orders/fulfilled': 'Order Fulfilled',
  'orders/partially_fulfilled': 'Order Partially Fulfilled',
  'orders/updated': 'Order Updated',
  'loyalty/points_credited': 'Points Credited',
  'loyalty/points_debited': 'Points Debited',
  'reviews/create': 'Review Submitted',
} as const;

export type ClevertapWebhookEventTopic = keyof typeof CLEVERTAP_WEBHOOK_EVENT_NAMES;

export const CLEVERTAP_FORWARDABLE_TOPICS: ReadonlyArray<{ topic: string; label: string }> = [
  { topic: 'orders/paid', label: 'Order Paid → Charged' },
  { topic: 'orders/cancelled', label: 'Order Cancelled' },
  { topic: 'orders/fulfilled', label: 'Order Fulfilled' },
  { topic: 'orders/updated', label: 'Order Updated' },
  { topic: 'customers/create', label: 'Customer Created' },
  { topic: 'customers/update', label: 'Customer Updated' },
  { topic: 'loyalty/points_credited', label: 'Points Credited' },
  { topic: 'loyalty/points_debited', label: 'Points Debited' },
  { topic: 'reviews/create', label: 'Review Submitted' },
];

export const CLEVERTAP_REGIONS = {
  in1: {
    label: 'India (in1)',
    apiHost: 'https://in1.api.clevertap.com',
    dashboard: 'https://in1.dashboard.clevertap.com',
  },
  eu1: {
    label: 'Europe / global (eu1)',
    apiHost: 'https://eu1.api.clevertap.com',
    dashboard: 'https://eu1.dashboard.clevertap.com',
  },
  sg1: {
    label: 'Singapore (sg1)',
    apiHost: 'https://sg1.api.clevertap.com',
    dashboard: 'https://sg1.dashboard.clevertap.com',
  },
  us1: {
    label: 'United States (us1)',
    apiHost: 'https://us1.api.clevertap.com',
    dashboard: 'https://us1.dashboard.clevertap.com',
  },
  aps3: {
    label: 'Indonesia (aps3)',
    apiHost: 'https://aps3.api.clevertap.com',
    dashboard: 'https://aps3.dashboard.clevertap.com',
  },
  mec1: {
    label: 'Middle East / UAE (mec1)',
    apiHost: 'https://mec1.api.clevertap.com',
    dashboard: 'https://mec1.dashboard.clevertap.com',
  },
} as const;

export type ClevertapRegion = keyof typeof CLEVERTAP_REGIONS;

export const DEFAULT_CLEVERTAP_REGION: ClevertapRegion = 'in1';

export { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from './openstore-events';
