/**
 * Per-module DI tokens. Kept separate from unicommerce.module.ts to avoid a
 * circular import between the module (defines providers) and guards.ts
 * (consumes UC_MERCHANTS via @Inject()) — same reasoning as every other
 * <App>/tokens.ts in this codebase.
 */
export const UC_CRYPTO = Symbol.for('ratio-app:unicommerce:crypto');
export const UC_RATIO = Symbol.for('ratio-app:unicommerce:ratio');
export const UC_MERCHANTS = Symbol.for('ratio-app:unicommerce:merchants');
export const UC_OAUTH = Symbol.for('ratio-app:unicommerce:oauth');
export const UC_WEBHOOKS = Symbol.for('ratio-app:unicommerce:webhooks');

// Vendor-specific (Unicommerce-side) wiring, beyond the five shared factory tokens.
/** The `RatioOAuthHttp` seam (fetch-based) — refreshes/rotates the Ratio merchant token. */
export const UC_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:unicommerce:ratio-oauth-http');
/** Ratio app OAuth client creds (RATIO_UNICOMMERCE_CLIENT_ID/SECRET), read from env. */
export const UC_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:unicommerce:ratio-oauth-creds');
