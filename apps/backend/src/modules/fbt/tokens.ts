/**
 * Fbt module DI tokens.
 *
 * These symbols live in their own file (separate from `fbt.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const FBT_CRYPTO = Symbol.for('ratio-app:fbt:crypto');
export const FBT_RATIO = Symbol.for('ratio-app:fbt:ratio');
export const FBT_MERCHANTS = Symbol.for('ratio-app:fbt:merchants');
export const FBT_OAUTH = Symbol.for('ratio-app:fbt:oauth');
export const FBT_WEBHOOKS = Symbol.for('ratio-app:fbt:webhooks');

/**
 * Ratio OAuth refresh plumbing, needed because the merchant access token stored
 * at install expires and product-source calls must refresh it. `core`'s
 * `OAuthService` only handles the install callback — it exposes no token getter.
 */
export const FBT_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:fbt:ratio-oauth-http');
export const FBT_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:fbt:ratio-oauth-creds');
