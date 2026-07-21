/**
 * Single source of truth for the list of app slugs the backend wires up.
 *
 * Lives in its own file (not `app.module.ts`) because `env.schema.ts` reads
 * this list during environment validation and is loaded VERY early — before
 * AppModule's decorator metadata is constructed. Pulling APPS from
 * `app.module.ts` would create a circular import.
 *
 * Adding a new app:
 *   1. Add its slug here.
 *   2. Add the corresponding `RATIO_<APP>_*` env keys (env.schema derives
 *      them from this list automatically).
 *   3. Import and register the concrete `<App>Module` in
 *      `module-registry.ts` — its load-time assertion fails loudly if the
 *      `APPS` tuple and registry drift.
 */
// `_template` is the golden boilerplate vendor. A scaffolded vendor adds its
// own slug here (use lowercase-alphanumeric-dash, e.g. 'loyalty').
export const APPS = ['google', 'meta', 'posthog', 'moengage', 'wizzy', 'rp', 'loyalty'] as const;
export type AppSlug = (typeof APPS)[number];

// Slugs flow into runtime URL regexes (main.ts rate-limit matchers). Reject
// anything that isn't lowercase-alphanumeric, dash, or a leading underscore
// (the `_template` boilerplate) so we don't smuggle regex metachars into those
// patterns. This is a load-time guardrail — adding a slug like `'app.v2'`
// would otherwise silently corrupt the dynamic regex interpolation in main.ts.
// Scaffolded production vendors should use plain `[a-z0-9-]` slugs.
for (const slug of APPS) {
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    throw new Error(`Invalid app slug '${slug}' — must match /^[a-z0-9_-]+$/`);
  }
}
