import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Widget build: ESM module entry (`src/widget.ts`).
// The loader (IIFE) is built by a second pass via `vite.loader.config.ts`
// because IIFE/UMD formats require a SINGLE input and cannot share a
// multi-input build with the ESM widget. The package `build` script runs
// this config first (emptyOutDir wipes dist), then the loader config with
// emptyOutDir disabled so both artifacts coexist in `dist/`.
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: true,
    rollupOptions: {
      input: { 'wizzy-widget': resolve(__dirname, 'src/widget.ts') },
      output: { entryFileNames: 'wizzy-widget.js', format: 'es', dir: 'dist' },
    },
  },
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
});
