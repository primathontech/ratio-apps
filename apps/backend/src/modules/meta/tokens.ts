/**
 * Meta module DI tokens.
 *
 * These symbols live in their own file (separate from `meta.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const META_CRYPTO = Symbol.for('ratio-app:meta:crypto');
export const META_RATIO = Symbol.for('ratio-app:meta:ratio');
export const META_MERCHANTS = Symbol.for('ratio-app:meta:merchants');
export const META_OAUTH = Symbol.for('ratio-app:meta:oauth');
export const META_WEBHOOKS = Symbol.for('ratio-app:meta:webhooks');
/** The `RatioOAuthHttp` seam (fetch-based) — refreshes/rotates the Ratio merchant token. */
export const META_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:meta:ratio-oauth-http');
/** Ratio app OAuth client creds (RATIO_META_CLIENT_ID/SECRET), read from env. */
export const META_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:meta:ratio-oauth-creds');
