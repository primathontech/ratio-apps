import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Single source of truth: the unified backend AND frontend env vars live
// together in the root .env. Vite doesn't natively read shared root envs,
// so we parse the file here and shovel VITE_*-prefixed entries into
// process.env BEFORE defineConfig runs.
//
// Load order (later wins on conflict, matches the backend's pattern):
//   1. ../../.env                — baseline / dev defaults
//   2. ../../.env.production     — only when NODE_ENV=production (override)
//
// For production builds: `NODE_ENV=production pnpm --filter <admin> build`.
// Anything already exported in the shell env (e.g. CI secrets) takes priority
// over both files — the `!(key in process.env)` guard preserves that.
const ENV_FILES: Array<readonly [string, boolean]> = [['../../.env', false]];
if (process.env.NODE_ENV === 'production') {
  ENV_FILES.push(['../../.env.production', true]);
}
for (const [relPath, override] of ENV_FILES) {
  const filePath = resolve(__dirname, relPath);
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!key.startsWith('VITE_')) continue;
      if (override || !(key in process.env)) {
        process.env[key] = value;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[vite] loaded env from ${filePath}${override ? ' (override)' : ''}`);
  } catch {
    // File not present — fine for CI builds where VITE_* comes from job env.
  }
}

const DEV_API_TARGET = process.env.FORMS_DEV_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  // Relative base: the app is served from a deep, version-pinned subpath on the
  // Ratio ecosystem host (e.g. /apps/<app>/<install>/<version>/index.html), not
  // the domain root. Absolute asset URLs (/assets/…) would 404 there. './' makes
  // index.html reference assets relative to its own location.
  base: './',
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../packages/shared/src'),
      // The SDK renderer embedded via the `?sdk` import pulls the shared
      // capability matrix (§2.3) from the Zod-free form-adornments module. Its
      // dist is CommonJS, whose named exports rollup can't statically trace, so
      // point that specifier at the ESM source (mirrors forms-sdk/vite.config.ts).
      '@ratio-app/shared/schemas/form-adornments': resolve(
        __dirname,
        '../../packages/shared/src/schemas/form-adornments.ts',
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Backend dev port. Defaults to 3000; override when the backend runs
      // elsewhere (e.g. FORMS_DEV_PROXY_TARGET=http://localhost:3001 to coexist
      // with another module on 3000).
      '/forms/api': { target: DEV_API_TARGET, changeOrigin: true },
      '/forms/sdk': { target: DEV_API_TARGET, changeOrigin: true },
      '/forms/auth': { target: DEV_API_TARGET, changeOrigin: true },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/routeTree.gen.ts',
        'src/test-setup.ts',
        'src/main.tsx',
      ],
    },
  },
});
