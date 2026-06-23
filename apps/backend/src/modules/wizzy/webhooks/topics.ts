/**
 * The exact `envelope.event` strings the Ratio runtime delivers, centralized so
 * the handler `topic` constants and the tests share one source of truth.
 * These match the platform webhook registry, which reports slash-delimited topics.
 */
export const WIZZY_WEBHOOK_TOPICS = {
  appUninstalled: 'app/uninstalled',
  productsCreate: 'products/create',
  productsUpdate: 'products/update',
  productsDelete: 'products/delete',
} as const;
