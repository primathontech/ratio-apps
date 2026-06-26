import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the BUILT __Slug__ SDK bundles.
 *
 * A tiny `node:http` static server (`e2e/server.mjs`) serves the package root on
 * http://localhost:5180 so both `/dist/*.js` and `/e2e/*.html` are reachable on
 * one origin. The spec intercepts `/__slug__/sdk/**` + `api.wizsearch.in/**` via
 * `page.route` so no real backend is required.
 *
 * Kept OUT of the default `test` script (which runs Vitest); run with
 * `pnpm --filter @ratio-app/__slug__-sdk e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/server.mjs',
    port: 5180,
    reuseExistingServer: !process.env.CI,
  },
});
