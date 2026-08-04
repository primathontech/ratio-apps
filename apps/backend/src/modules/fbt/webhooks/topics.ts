/**
 * Inbound Ratio webhook topics FBT subscribes to.
 *
 * A topic string must equal EXACTLY the `event` value the Ratio runtime delivers.
 * `WebhooksService.dispatch` routes by exact string match and SILENTLY no-ops on a
 * mismatch (the topic-mismatch fast path) — so a wrong value here does not error,
 * it just means the handler never runs.
 *
 * These four values are the authoritative registry, confirmed against the platform's
 * own webhook-events documentation tool: slash-delimited, PLURAL resource, base-verb form.
 * `wizzy` and `google` carry the identical set. Note `_template` still ships the old
 * dot-form (`app.uninstalled`), which is WRONG — do not copy it when scaffolding.
 */
export const FBT_TOPICS = {
  APP_UNINSTALLED: 'app/uninstalled',
  PRODUCT_CREATED: 'products/create',
  PRODUCT_UPDATED: 'products/update',
  PRODUCT_DELETED: 'products/delete',
} as const;
