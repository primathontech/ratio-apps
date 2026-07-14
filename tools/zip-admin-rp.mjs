/**
 * Package the admin-rp shell as a ready-to-upload zip.
 *
 *   pnpm zip:admin:rp   →   ./zip/admin-rp.zip
 *
 * The shell is a thin redirect to the local dev tunnel (see apps/admin-rp-shell/index.html).
 * Upload once to the Ratio ecosystem — UI changes on the dev server are instant via refresh.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shell = resolve(root, 'apps/admin-rp-shell');
const zipDir = resolve(root, 'zip');
const out = resolve(zipDir, 'admin-rp.zip');

if (!existsSync(shell)) {
  console.error(`[zip] shell not found at ${shell}`);
  process.exit(1);
}

mkdirSync(zipDir, { recursive: true });
rmSync(out, { force: true });

console.log('[zip] packaging shell → zip/admin-rp.zip');
execSync(`cd "${shell}" && zip -rq "${out}" .`, { stdio: 'inherit' });
console.log(`[zip] done → ${out}`);
