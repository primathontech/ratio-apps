/**
 * The exact `event_type` strings the Ratio platform delivers (slash-form, per
 * docs/agent/context/learnings.md — the `_template`'s dot-form
 * `app.uninstalled` is the template example, NOT the live registry format).
 * Verify against a live delivery before launch: a wrong topic silently
 * no-ops via the dispatcher's topic-mismatch fast-path.
 */
export const DELHIVERY_WEBHOOK_TOPICS = {
  appUninstalled: 'app/uninstalled',
  ordersPaid: 'orders/paid',
  ordersCancelled: 'orders/cancelled',
  ordersEdited: 'orders/edited',
} as const;

/**
 * `order.source` values that mark a Ratio-storefront order (the
 * double-shipment guard — Shopify-routed orders ship via the merchant's
 * existing pipeline). Live dashboard showed `"Online Store"`; keep the list
 * tight and extend once the platform contract is confirmed (TRD §7.4).
 */
const RATIO_ORIGIN_SOURCES = new Set(['online store', 'ratio', 'ratio storefront']);

export function isRatioOrigin(source: unknown): boolean {
  return typeof source === 'string' && RATIO_ORIGIN_SOURCES.has(source.trim().toLowerCase());
}
