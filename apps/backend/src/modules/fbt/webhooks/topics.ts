/**
 * Inbound Ratio webhook topics FBT subscribes to.
 *
 * A topic string must equal EXACTLY the `event` value the Ratio runtime
 * delivers — the dispatcher's topic-mismatch fast path means a wrong string
 * silently no-ops rather than erroring. Verify each against a live delivery
 * when registering the app; the platform registry has historically documented
 * slash-form (`app/uninstalled`) while the runtime delivered dot-form.
 */
export const FBT_TOPICS = {
  APP_UNINSTALLED: 'app.uninstalled',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
} as const;
