/**
 * Delhivery module DI tokens.
 *
 * These symbols live in their own file (separate from `delhivery.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const DELHIVERY_CRYPTO = Symbol.for('ratio-app:delhivery:crypto');
export const DELHIVERY_RATIO = Symbol.for('ratio-app:delhivery:ratio');
export const DELHIVERY_MERCHANTS = Symbol.for('ratio-app:delhivery:merchants');
export const DELHIVERY_OAUTH = Symbol.for('ratio-app:delhivery:oauth');
export const DELHIVERY_WEBHOOKS = Symbol.for('ratio-app:delhivery:webhooks');

// Vendor-specific (carrier-side) wiring, beyond the five shared factory tokens.
/** The `RatioOrdersPort` — reads/patches the merchant's Ratio orders + products. */
export const DELHIVERY_ORDERS = Symbol.for('ratio-app:delhivery:orders');
/** The KwikEngage shipping-events client seam (fetch-based; tests mock it). */
export const DELHIVERY_KWIKENGAGE = Symbol.for('ratio-app:delhivery:kwikengage');
/** The `RatioOAuthHttp` seam (fetch-based) — refreshes/rotates the Ratio merchant token. */
export const DELHIVERY_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:delhivery:ratio-oauth-http');
/** Ratio app OAuth client creds (RATIO_DELHIVERY_CLIENT_ID/SECRET), read from env. */
export const DELHIVERY_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:delhivery:ratio-oauth-creds');
