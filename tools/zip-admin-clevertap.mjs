/**
 * Build the admin-clevertap SPA and package it as a ready-to-publish zip.
 *
 *   pnpm zip:admin:clevertap   →   ./zip/admin-clevertap.zip
 *
 * Zips the CONTENTS of apps/admin-clevertap/dist (so index.html sits at the zip
 * root, matching Vite's relative `base: './'` — the app store serves it from a
 * version-pinned subpath). Requires the `zip` CLI (preinstalled on Linux/macOS).
 *
 * ⚠️ `VITE_API_BASE_URL` IS BAKED IN AT BUILD TIME. The admin is iframed in the
 * VIEWER's browser, so the value must be reachable from wherever the app is
 * opened:
 *   - `http://localhost:3001` (the repo default) works ONLY on the machine
 *     running the backend — that is the documented single-machine dev pattern.
 *   - For a build anyone else will open, pass a public base:
 *       VITE_API_BASE_URL=https://your-domain pnpm zip:admin:clevertap
 *
 * ⚠️ ngrok free-tier caveat: it intercepts browser-UA requests with a warning
 * page unless `ngrok-skip-browser-warning` is sent. `lib/api.ts` does NOT send
 * that header, so an `*.ngrok-free.*` base will fail on the interstitial until
 * it does (see docs/agent/context/learnings.md, 2026-07-15).
 *
 * The zip prints the baked base so a wrong one is caught before upload rather
 * than after a merchant sees a broken iframe.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'apps/admin-clevertap/dist');
const zipDir = resolve(root, 'zip');
const out = resolve(zipDir, 'admin-clevertap.zip');

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

console.log('[zip] building admin-clevertap…');
run('pnpm build:admin:clevertap', { cwd: root });

if (!existsSync(dist)) {
  console.error(`[zip] dist not found at ${dist} — build failed?`);
  process.exit(1);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`[zip] no index.html in ${dist} — the app store serves it from the zip root.`);
  process.exit(1);
}

// Surface the baked API base: getting this wrong is the single most common way a
// published admin build ends up as a blank iframe.
const assetsDir = join(dist, 'assets');
const bundles = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  : [];
const bases = new Set();
for (const f of bundles) {
  const src = readFileSync(join(assetsDir, f), 'utf8');
  for (const m of src.matchAll(/https?:\/\/[a-zA-Z0-9._:-]+(?=\/clevertap|["'`])/g)) {
    const u = m[0];
    // Ignore the schema/spec URLs bundled by dependencies.
    if (!/w3\.org|json-schema\.org|github\.io|schema\.org/.test(u)) bases.add(u);
  }
}
console.log(`[zip] API base(s) baked into the bundle: ${[...bases].join(', ') || '(none found)'}`);
if ([...bases].some((b) => b.includes('localhost'))) {
  console.log('[zip] ⚠️  localhost base — this build only works on the machine running the API.');
}
if ([...bases].some((b) => b.includes('ngrok-free'))) {
  console.log(
    '[zip] ⚠️  ngrok-free base — see the header note: the warning interstitial will break fetches.',
  );
}

mkdirSync(zipDir, { recursive: true });
rmSync(out, { force: true });

console.log('[zip] packaging dist → zip/admin-clevertap.zip');
// Zip the contents of dist (index.html at the zip root), not the dist folder.
run(`cd "${dist}" && zip -rq "${out}" .`);

const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`[zip] done → ${out} (${kb} KB)`);
