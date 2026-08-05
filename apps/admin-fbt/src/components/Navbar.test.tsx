import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREENS } from './Navbar';

const ROUTES_DIR = resolve(__dirname, '../routes');

describe('admin navigation', () => {
  // Pinned as literals, not derived from SCREENS — asserting
  // `SCREENS.map(s => s.path)` against itself would only prove internal
  // consistency and would pass no matter what the nav became.
  it('exposes exactly the five FBT screens', () => {
    expect(SCREENS.map((s) => s.path)).toEqual([
      '/',
      '/bundles',
      '/recommendations',
      '/appearance',
      '/preview',
    ]);
    expect(SCREENS.map((s) => s.label)).toEqual([
      'Dashboard',
      'Bundles',
      'Recommendations',
      'Appearance',
      'Preview',
    ]);
  });

  // FBT is not a pixel: it forwards no storefront events (so there is no event
  // map to edit) and its widget is served by an already-deployed storefront
  // wrapper (so there is no `<script>` tag to paste). These three routes came
  // from the `_template` scaffold, which is PostHog-shaped. Re-scaffolding this
  // admin must not drag them back in.
  it.each(['/config', '/events', '/install'])(
    'does not carry the pixel-era %s screen',
    (deadPath) => {
      expect(SCREENS.map((s) => s.path)).not.toContain(deadPath);
      const file = deadPath === '/' ? 'index.tsx' : `${deadPath.slice(1)}.tsx`;
      expect(existsSync(resolve(ROUTES_DIR, file))).toBe(false);
    },
  );

  // A nav entry pointing at a route file that does not exist renders a link
  // that 404s inside the SPA. TanStack's generated route tree would catch a
  // bad `to=` at build time, but only for routes it knows about — this keeps
  // the two lists honest against each other.
  it.each(SCREENS.map((s) => s.path))('has a route file backing %s', (path) => {
    const file = path === '/' ? 'index.tsx' : `${path.slice(1)}.tsx`;
    expect(existsSync(resolve(ROUTES_DIR, file))).toBe(true);
  });
});
