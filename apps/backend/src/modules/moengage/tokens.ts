/**
 * Per-module DI tokens. Kept in a separate file to break a circular import
 * between `moengage.module.ts` (defines the providers) and `guards.ts`
 * (consumes `MOENGAGE_MERCHANTS` via `@Inject()`). If both lived in the
 * module file, the guard import would race the module's `Symbol.for(...)`
 * literal initialization and `MOENGAGE_MERCHANTS` would be observed as
 * `undefined` (TDZ).
 */
export const MOENGAGE_CRYPTO = Symbol.for('ratio-app:moengage:crypto');
export const MOENGAGE_RATIO = Symbol.for('ratio-app:moengage:ratio');
export const MOENGAGE_MERCHANTS = Symbol.for('ratio-app:moengage:merchants');
export const MOENGAGE_OAUTH = Symbol.for('ratio-app:moengage:oauth');
export const MOENGAGE_WEBHOOKS = Symbol.for('ratio-app:moengage:webhooks');
