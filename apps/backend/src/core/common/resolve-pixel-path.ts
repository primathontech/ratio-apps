import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Per-module pixel file slug. Determines the filename (`<slug>-pixel.js`) and
 * is otherwise opaque to this helper. A plain string (not `AppSlug`) so the
 * golden-reference `_template` module — kept in the repo but NOT in `APPS` —
 * still compiles; mounted vendors pass their own slug literal.
 */
export type PixelSlug = string;

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
  // nest-cli.json copies `../static/**/*` into `dist/apps/backend/`, so in a
  // compiled/Docker run the pixel ships at `dist/apps/backend/<slug>-pixel.js`
  // (NOT under a `static/` subdir). From a caller in
  // `dist/apps/backend/src/modules/<slug>/sdk/` that's 4 `..` up. Without this
  // candidate the resolver misses the bundled asset and 503s with PIXEL_MISSING.
  const nestAssetLayout = resolve(callerDir, '..', '..', '..', '..', filename);
  const candidates = [
    srcLayout,
    distLayout,
    nestAssetLayout,
    resolve(process.cwd(), 'static', filename), // cwd = apps/backend
    resolve(process.cwd(), 'apps', 'backend', 'static', filename), // cwd = repo root
    resolve(process.cwd(), 'apps', 'backend', 'dist', 'apps', 'backend', filename), // cwd = repo root, compiled
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Robust fallback: walk UP from callerDir and, at each ancestor, check both
  // `<dir>/<filename>` (nest-cli asset-copy layout) and `<dir>/static/<filename>`
  // (source layout). This finds the bundle regardless of the exact nesting
  // depth or process cwd, so a build that DID emit the pixel never 503s with
  // PIXEL_MISSING just because the relative-up math didn't match this layout.
  // Bounded to a sane number of levels so a missing file can't walk to `/`.
  let dir = callerDir;
  for (let i = 0; i < 12; i++) {
    const direct = resolve(dir, filename);
    if (existsSync(direct)) return direct;
    const inStatic = resolve(dir, 'static', filename);
    if (existsSync(inStatic)) return inStatic;
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }

  // Nothing found anywhere → return the src-layout path so the caller's
  // downstream `readFile` produces a clear ENOENT at the expected location.
  return srcLayout;
}
