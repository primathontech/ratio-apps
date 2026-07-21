/**
 * Build the admin-rp SPA and package it as a ready-to-publish zip.
 *
 *   pnpm zip:admin:rp   →   ./zip/admin-rp.zip
 *
 * Zips the CONTENTS of apps/admin-rp/dist (so index.html sits at the zip
 * root, matching Vite's relative `base: './'` — the app store serves it from a
 * version-pinned subpath). Requires the `zip` CLI (preinstalled on Linux/macOS).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'apps/admin-rp/dist');
const zipDir = resolve(root, 'zip');
const out = resolve(zipDir, 'admin-rp.zip');

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

console.log('[zip] building admin-rp…');
run('pnpm build:admin:rp', { cwd: root });

if (!existsSync(dist)) {
  console.error(`[zip] dist not found at ${dist} — build failed?`);
  process.exit(1);
}

mkdirSync(zipDir, { recursive: true });
rmSync(out, { force: true });

console.log('[zip] packaging dist → zip/admin-rp.zip');
// Zip the contents of dist (index.html at the zip root), not the dist folder.
run(`cd "${dist}" && zip -rq "${out}" .`);

console.log(`[zip] done → ${out}`);
