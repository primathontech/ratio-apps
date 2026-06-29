/**
 * Wizzy module DI tokens.
 *
 * These symbols live in their own file (separate from `wizzy.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const WIZZY_CRYPTO = Symbol.for('ratio-app:wizzy:crypto');
export const WIZZY_RATIO = Symbol.for('ratio-app:wizzy:ratio');
export const WIZZY_MERCHANTS = Symbol.for('ratio-app:wizzy:merchants');
export const WIZZY_OAUTH = Symbol.for('ratio-app:wizzy:oauth');
export const WIZZY_WEBHOOKS = Symbol.for('ratio-app:wizzy:webhooks');

// Vendor-specific (Wizzy-side) wiring, beyond the five shared factory tokens.
/** The `RatioProductsPort` — reads the merchant's Ratio product catalog. */
export const WIZZY_RATIO_PRODUCTS = Symbol.for('ratio-app:wizzy:ratio-products');
/** The `RatioOAuthHttp` seam (fetch-based) — refreshes/rotates the Ratio merchant token. */
export const WIZZY_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:wizzy:ratio-oauth-http');
/** Ratio app OAuth client creds (RATIO_WIZZY_CLIENT_ID/SECRET), read from env. */
export const WIZZY_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:wizzy:ratio-oauth-creds');
