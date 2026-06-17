/**
 * Template module DI tokens.
 *
 * These symbols live in their own file (separate from `_template.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const TEMPLATE_CRYPTO = Symbol.for('ratio-app:_template:crypto');
export const TEMPLATE_RATIO = Symbol.for('ratio-app:_template:ratio');
export const TEMPLATE_MERCHANTS = Symbol.for('ratio-app:_template:merchants');
export const TEMPLATE_OAUTH = Symbol.for('ratio-app:_template:oauth');
export const TEMPLATE_WEBHOOKS = Symbol.for('ratio-app:_template:webhooks');
