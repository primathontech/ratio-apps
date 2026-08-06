/**
 * Build the admin-unicommerce SPA and package it as a ready-to-publish zip.
 *
 *   pnpm zip:admin:unicommerce   →   ./zip/admin-unicommerce.zip
 *
 * Zips the CONTENTS of apps/admin-unicommerce/dist (so index.html sits at the
 * zip root, matching Vite's relative `base: './'` — the app store serves it
 * from a version-pinned subpath). Requires the `zip` CLI (preinstalled on
 * Linux/macOS).
 *
 * VITE_API_BASE_URL must point at a PUBLICLY reachable backend before
 * building — the bundle runs in the merchant's real browser, so
 * `http://localhost:3000` (the shared root `.env` default) would be
 * unreachable. Pass it as an env override:
 *
 *   VITE_API_BASE_URL=https://your-tunnel.example pnpm zip:admin:unicommerce
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'apps/admin-unicommerce/dist');
const zipDir = resolve(root, 'zip');
const out = resolve(zipDir, 'admin-unicommerce.zip');

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

if (!process.env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL.includes('localhost')) {
  console.warn(
    '[zip] WARNING: VITE_API_BASE_URL is unset or points at localhost — the ' +
      'packaged SPA will be unreachable once uploaded. Re-run with e.g.\n' +
      '  VITE_API_BASE_URL=https://your-tunnel.example pnpm zip:admin:unicommerce',
  );
}

console.log('[zip] building admin-unicommerce…');
run('pnpm build:admin:unicommerce', { cwd: root });

if (!existsSync(dist)) {
  console.error(`[zip] dist not found at ${dist} — build failed?`);
  process.exit(1);
}

mkdirSync(zipDir, { recursive: true });
rmSync(out, { force: true });

console.log('[zip] packaging dist → zip/admin-unicommerce.zip');
// Zip the contents of dist (index.html at the zip root), not the dist folder.
run(`cd "${dist}" && zip -rq "${out}" .`);

console.log(`[zip] done → ${out}`);
