export const CLEVERTAP_WEBHOOK_TOPICS = {
  appUninstalled: 'app/uninstalled',
  ordersPaid: 'orders/paid',
  ordersCreate: 'orders/create',
  ordersCancelled: 'orders/cancelled',
  ordersFulfilled: 'orders/fulfilled',
  ordersPartiallyFulfilled: 'orders/partially_fulfilled',
  ordersUpdated: 'orders/updated',
  customersCreate: 'customers/create',
  customersUpdate: 'customers/update',
  loyaltyPointsCredited: 'loyalty/points_credited',
  loyaltyPointsDebited: 'loyalty/points_debited',
  reviewsCreate: 'reviews/create',
  productsCreate: 'products/create',
  productsUpdate: 'products/update',
  productsDelete: 'products/delete',
} as const;

export type ClevertapWebhookTopic =
  (typeof CLEVERTAP_WEBHOOK_TOPICS)[keyof typeof CLEVERTAP_WEBHOOK_TOPICS];

export type ClevertapCustomerTopic =
  | typeof CLEVERTAP_WEBHOOK_TOPICS.customersCreate
  | typeof CLEVERTAP_WEBHOOK_TOPICS.customersUpdate;
