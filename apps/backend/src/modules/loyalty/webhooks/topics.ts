/**
 * The exact `envelope.event_type` strings the Ratio runtime delivers,
 * centralized so the handler `topic` constants and the tests share one source
 * of truth. Slash-form matches the platform webhook registry (verified for
 * wizzy; see docs/agent/context/learnings.md).
 */
export const LOYALTY_WEBHOOK_TOPICS = {
  appUninstalled: 'app/uninstalled',
  ordersCreate: 'orders/create',
  ordersCancelled: 'orders/cancelled',
} as const;
