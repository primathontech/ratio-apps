/**
 * The exact `envelope.event` strings the Ratio runtime delivers, centralized so
 * the handler `topic` constants and the tests share one source of truth
 * (TRD R1). These match the platform webhook registry (`get_webhook_events`),
 * which reports slash-delimited topics.
 *
 * R1 — verify against a real delivery before go-live: a topic constant that
 * doesn't match the delivered `event` string causes the dispatcher to silently
 * skip the handler (the topic-mismatch fast-path). If the runtime turns out to
 * deliver dot-delimited events (as the `_template` example assumes), change the
 * values here in one place.
 */
export const GOOGLE_WEBHOOK_TOPICS = {
  appUninstalled: 'app/uninstalled',
  productsCreate: 'products/create',
  productsUpdate: 'products/update',
  productsDelete: 'products/delete',
} as const;
