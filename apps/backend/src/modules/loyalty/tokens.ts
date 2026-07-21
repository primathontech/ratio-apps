/**
 * Loyalty module DI tokens.
 *
 * These symbols live in their own file (separate from `loyalty.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const LOYALTY_CRYPTO = Symbol.for('ratio-app:loyalty:crypto');
export const LOYALTY_RATIO = Symbol.for('ratio-app:loyalty:ratio');
export const LOYALTY_MERCHANTS = Symbol.for('ratio-app:loyalty:merchants');
export const LOYALTY_OAUTH = Symbol.for('ratio-app:loyalty:oauth');
export const LOYALTY_WEBHOOKS = Symbol.for('ratio-app:loyalty:webhooks');
export const LOYALTY_RATIO_OAUTH_HTTP = Symbol.for('ratio-app:loyalty:ratio-oauth-http');
export const LOYALTY_RATIO_OAUTH_CREDS = Symbol.for('ratio-app:loyalty:ratio-oauth-creds');
export const LOYALTY_CORE_CLIENT = Symbol.for('ratio-app:loyalty:core-client');
export const LOYALTY_GK_IDENTITY = Symbol.for('ratio-app:loyalty:gk-identity');
