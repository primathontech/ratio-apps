/**
 * Forms module DI tokens.
 *
 * These symbols live in their own file (separate from `forms.module.ts`) to
 * break the circular import between the module file and its sibling
 * services/guards — many of those depend on the tokens via `@Inject(...)`, and
 * the module file in turn imports the services/guards. Pushing the tokens
 * here keeps that graph acyclic.
 */
export const FORMS_CRYPTO = Symbol.for('ratio-app:forms:crypto');
export const FORMS_RATIO = Symbol.for('ratio-app:forms:ratio');
export const FORMS_MERCHANTS = Symbol.for('ratio-app:forms:merchants');
export const FORMS_OAUTH = Symbol.for('ratio-app:forms:oauth');
export const FORMS_WEBHOOKS = Symbol.for('ratio-app:forms:webhooks');
