/**
 * Google module DI tokens.
 *
 * These symbols live in their own file (separate from `google.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const GOOGLE_CRYPTO = Symbol.for('ratio-app:google:crypto');
export const GOOGLE_RATIO = Symbol.for('ratio-app:google:ratio');
export const GOOGLE_MERCHANTS = Symbol.for('ratio-app:google:merchants');
export const GOOGLE_OAUTH = Symbol.for('ratio-app:google:oauth');
export const GOOGLE_WEBHOOKS = Symbol.for('ratio-app:google:webhooks');

// Vendor-specific (Google-side) wiring, beyond the five shared factory tokens.
/** The `GoogleOAuthHttp` seam (fetch-based) — injectable so tests mock the network. */
export const GOOGLE_OAUTH_HTTP = Symbol.for('ratio-app:google:oauth-http');
/** Google's own OAuth client creds + scopes, read from env. */
export const GOOGLE_OAUTH_CREDS = Symbol.for('ratio-app:google:oauth-creds');
/** The `RatioProductsPort` — reads the merchant's Ratio product catalog. */
export const GOOGLE_RATIO_PRODUCTS = Symbol.for('ratio-app:google:ratio-products');
/** The `WebPixelsApi` seam — the (Draft) Web Pixels registration API. */
export const GOOGLE_WEB_PIXELS = Symbol.for('ratio-app:google:web-pixels');
/** The `RatioOAuthHttp` seam (fetch-based) — refreshes/rotates the Ratio merchant token. */
export const GOOGLE_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:google:ratio-oauth-http');
/** Ratio app OAuth client creds (RATIO_GOOGLE_CLIENT_ID/SECRET), read from env. */
export const GOOGLE_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:google:ratio-oauth-creds');
