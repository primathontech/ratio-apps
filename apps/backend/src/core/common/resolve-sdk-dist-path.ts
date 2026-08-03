import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Per-app SDK slug → package dir `packages/<slug>-sdk/dist` and env key `<SLUG>_SDK_DIST`; a plain string so the non-`APPS` `_template` module can reuse it. */
export type SdkSlug = string;

/** Locate the built SDK dist dir `packages/<slug>-sdk/dist` via `<SLUG>_SDK_DIST` override, then cwd-relative candidates, then a bounded upward walk from `callerDir`; returns the directory (falls back to the primary cwd candidate so a downstream read fails with a clear error). */
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

  // Fallback: walk up from callerDir, bounded so a missing dist can't reach `/`.
  if (callerDir) {
    let dir = callerDir;
    for (let i = 0; i < 12; i++) {
      const p = resolve(dir, rel);
      if (existsSync(p)) return p;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return primary;
}
