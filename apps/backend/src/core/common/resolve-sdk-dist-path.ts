import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Per-app SDK slug. Determines the package directory (`packages/<slug>-sdk/dist`)
 * and the env override key (`<SLUG>_SDK_DIST`). A plain string (not `AppSlug`)
 * so the golden-reference `_template` module — kept in the repo but NOT in
 * `APPS` — could reuse it; mounted vendors pass their own slug literal.
 */
export type SdkSlug = string;

/**
 * Locate the built storefront SDK bundle directory `packages/<slug>-sdk/dist`
 * across the layouts a run can take, unifying the ad-hoc resolution that lived
 * in the forms SDK service and the wizzy storefront controller.
 *
 * Resolution order:
 *   1. `<SLUG>_SDK_DIST` env override (e.g. `FORMS_SDK_DIST`, `WIZZY_SDK_DIST`)
 *      — used verbatim for non-standard layouts and tests. Derived by
 *      upper-casing the slug, so every app gets a consistent key with no
 *      per-module wiring.
 *   2. `process.cwd()`-relative candidates. `cwd` is the repo root under PM2,
 *      Docker, and dev-from-root, but `apps/backend` under
 *      `pnpm --filter backend dev`; both are probed.
 *   3. A bounded upward walk from `callerDir` (pass `__dirname`) looking for
 *      `packages/<slug>-sdk/dist`, so a built bundle is still found when the
 *      process cwd matches neither candidate above.
 *
 * Returns the DIRECTORY (callers append their own bundle file name — forms has
 * one bundle, wizzy has three). When nothing is found we return the primary
 * cwd candidate so the caller's downstream read fails with a clear error at the
 * expected location rather than somewhere surprising.
 */
export function resolveSdkDistPath(slug: SdkSlug, callerDir?: string): string {
  const override = process.env[`${slug.toUpperCase()}_SDK_DIST`];
  if (override) return override;

  const rel = `packages/${slug}-sdk/dist`;
  const primary = resolve(process.cwd(), rel); // cwd = repo root (PM2 / Docker / dev-from-root)
  const candidates = [
    primary,
    resolve(process.cwd(), '..', '..', rel), // cwd = apps/backend (pnpm --filter dev)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Robust fallback: walk UP from the caller's directory looking for the dist
  // dir, so a built bundle is found regardless of the exact process cwd.
  // Bounded to a sane number of levels so a missing dist can't walk to `/`.
  if (callerDir) {
    let dir = callerDir;
    for (let i = 0; i < 12; i++) {
      const p = resolve(dir, rel);
      if (existsSync(p)) return p;
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
  }

  // Nothing found anywhere → return the primary cwd candidate so the caller's
  // downstream read produces a clear error at the expected location.
  return primary;
}
