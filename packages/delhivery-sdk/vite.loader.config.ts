import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Loader build: IIFE bootstrap script (`src/loader.ts`), single input.
// Served per-merchant by the backend at `/delhivery/sdk/<merchantId>.js`
// (with a `window.__DELHIVERY__` prelude prepended). Runs as the SECOND
// build pass after the widget build. emptyOutDir is disabled so it does
// not wipe the widget artifact emitted by the first pass.
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: false,
    rollupOptions: {
      input: { 'delhivery-loader': resolve(__dirname, 'src/loader.ts') },
      output: {
        entryFileNames: 'delhivery-loader.js',
        format: 'iife',
        name: 'DelhiveryLoader',
        dir: 'dist',
      },
    },
  },
});
