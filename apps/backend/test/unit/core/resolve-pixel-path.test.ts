import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePixelPath } from '../../../src/core/common/resolve-pixel-path';

/**
 * resolvePixelPath must locate `<slug>-pixel.js` across the layouts a build can
 * produce — and never 503 when the file genuinely exists somewhere reasonable.
 */
// A slug with NO real bundle in apps/backend/static — so the resolver's
// process.cwd() candidates can't match the real repo and pollute these tests
// (we exercise only the callerDir-relative logic + the upward walk).
const SLUG = 'unittest';
const FILE = `${SLUG}-pixel.js`;

describe('resolvePixelPath', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pixel-resolve-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** The compiled SDK caller dir: dist/apps/backend/src/modules/google/sdk. */
  function callerDir(): string {
    const d = join(root, 'dist', 'apps', 'backend', 'src', 'modules', 'google', 'sdk');
    mkdirSync(d, { recursive: true });
    return d;
  }

  it('finds the nest-cli asset copy at dist/apps/backend/<slug>-pixel.js', () => {
    const caller = callerDir();
    const expected = join(root, 'dist', 'apps', 'backend', FILE);
    writeFileSync(expected, '// pixel');
    expect(resolvePixelPath(SLUG, caller)).toBe(expected);
  });

  it('finds a source-layout static/ bundle', () => {
    const caller = callerDir();
    const staticDir = join(root, 'dist', 'apps', 'backend', 'static');
    mkdirSync(staticDir, { recursive: true });
    const expected = join(staticDir, FILE);
    writeFileSync(expected, '// pixel');
    expect(resolvePixelPath(SLUG, caller)).toBe(expected);
  });

  it('falls back to the upward walk when the file sits at an unexpected nesting depth', () => {
    // caller is nested ONE level deeper than the fixed candidates expect, so
    // only the upward directory walk can locate the bundle.
    const caller = join(
      root,
      'dist',
      'apps',
      'backend',
      'src',
      'modules',
      'google',
      'sdk',
      'extra',
    );
    mkdirSync(caller, { recursive: true });
    const expected = join(root, 'dist', 'apps', 'backend', FILE);
    writeFileSync(expected, '// pixel');
    expect(resolvePixelPath(SLUG, caller)).toBe(expected);
  });

  it('returns the src-layout path (clear ENOENT target) when the pixel is missing entirely', () => {
    const caller = callerDir();
    const result = resolvePixelPath(SLUG, caller);
    // No file written anywhere → fallback, not a throw.
    expect(result).toBe(resolve(caller, '..', '..', '..', '..', 'static', FILE));
  });
});
