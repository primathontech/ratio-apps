/**
 * PostHog module DI tokens.
 *
 * These symbols live in their own file (separate from `posthog.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const POSTHOG_CRYPTO = Symbol.for('ratio-app:posthog:crypto');
export const POSTHOG_RATIO = Symbol.for('ratio-app:posthog:ratio');
export const POSTHOG_MERCHANTS = Symbol.for('ratio-app:posthog:merchants');
export const POSTHOG_OAUTH = Symbol.for('ratio-app:posthog:oauth');
export const POSTHOG_WEBHOOKS = Symbol.for('ratio-app:posthog:webhooks');
