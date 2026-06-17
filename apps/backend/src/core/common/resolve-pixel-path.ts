import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppSlug } from '../../config/apps';

/**
 * Per-module pixel file slug. Determines both the filename
 * (`<slug>-pixel.js`) and is otherwise opaque to this helper.
 *
 * Derived from `AppSlug` so adding a new app to `config/apps.ts` is the
 * single source of truth — the union here stays in lockstep automatically.
 */
export type PixelSlug = AppSlug;

/**
 * Locate `apps/backend/static/<slug>-pixel.js` regardless of whether we're
 * running from TS source (`apps/backend/src/modules/<slug>/sdk/`) or
 * compiled output (`apps/backend/dist/apps/backend/src/modules/<slug>/sdk/`).
 *
 * Both layouts converge on the same `apps/backend/static/<slug>-pixel.js` —
 * but the relative-up distance from a caller in `modules/<slug>/sdk/`
 * differs:
 *   - src  layout: 4 `..` (sdk → <slug> → modules → src → apps/backend)
 *   - dist layout: 6 `..` (the same hops, plus the two extra
 *     `apps/backend/` segments that tsc emits in `outDir`)
 *
 * `callerDir` is the directory of the SDK service importing this helper —
 * pass `__dirname` from the call site. We try candidates in order and
 * return the first that exists. If none exist, we return the src-layout
 * fallback so the caller's downstream `readFile` produces a clear ENOENT
 * pointing at the expected location rather than at `process.cwd()`.
 */
export function resolvePixelPath(slug: PixelSlug, callerDir: string): string {
  const filename = `${slug}-pixel.js`;
  const srcLayout = resolve(callerDir, '..', '..', '..', '..', 'static', filename);
  const distLayout = resolve(callerDir, '..', '..', '..', '..', '..', '..', 'static', filename);
  const candidates = [
    srcLayout,
    distLayout,
    resolve(process.cwd(), 'static', filename), // cwd = apps/backend
    resolve(process.cwd(), 'apps', 'backend', 'static', filename), // cwd = repo root
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return srcLayout;
}
