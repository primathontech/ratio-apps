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
