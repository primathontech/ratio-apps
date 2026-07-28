/** Forms DI tokens; in their own file to break the module↔services/guards circular import. */
export const FORMS_CRYPTO = Symbol.for('ratio-app:forms:crypto');
export const FORMS_RATIO = Symbol.for('ratio-app:forms:ratio');
export const FORMS_MERCHANTS = Symbol.for('ratio-app:forms:merchants');
export const FORMS_OAUTH = Symbol.for('ratio-app:forms:oauth');
export const FORMS_WEBHOOKS = Symbol.for('ratio-app:forms:webhooks');
