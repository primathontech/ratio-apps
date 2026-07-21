import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Claim-widget build: ESM module entry (`src/claim-widget.ts`), Lit bundled.
// The loader (IIFE) is built by a second pass via `vite.loader.config.ts`
// because IIFE format requires a SINGLE input and cannot share a multi-input
// build with the ESM bundle. The package `build` script runs this config first
// (emptyOutDir wipes dist), then the loader config with emptyOutDir disabled
// so both artifacts coexist in `dist/`.
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: true,
    rollupOptions: {
      input: { 'loyalty-claim': resolve(__dirname, 'src/claim-widget.ts') },
      output: { entryFileNames: 'loyalty-claim.js', format: 'es', dir: 'dist' },
    },
  },
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
});
