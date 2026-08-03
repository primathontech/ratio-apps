import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Widget build: ESM module entry (`src/widget.ts`).
// The loader (IIFE) is built by a second pass via `vite.loader.config.ts`
// because IIFE/UMD formats require a SINGLE input and cannot share a
// multi-input build with the ESM widget. The package `build` script runs
// this config first (emptyOutDir wipes dist), then the loader config with
// emptyOutDir disabled so both artifacts coexist in `dist/`.
export default defineConfig({
  resolve: {
    // The shared dist is CommonJS, whose named exports rollup can't statically
    // trace; point the widget build at the ESM TypeScript source. These are all
    // Zod-free modules (the §2.3 capability matrix + the per-field runtime
    // constants the renderers use), so importing the source keeps Zod out of
    // the widget bundle.
    alias: [
      {
        find: /^@ratio-app\/shared\/schemas\/form-adornments$/,
        replacement: resolve(__dirname, '../shared/src/schemas/form-adornments.ts'),
      },
      {
        // Per-field runtime constants: `<type>/constants` plus the shared
        // select-family `_shared/select-constants` (all Zod-free).
        find: /^@ratio-app\/shared\/schemas\/fields\/([^/]+)\/([\w-]*constants)$/,
        replacement: resolve(__dirname, '../shared/src/schemas/fields/$1/$2.ts'),
      },
    ],
  },
  build: {
    target: 'es2019',
    emptyOutDir: true,
    rollupOptions: {
      input: { 'forms-widget': resolve(__dirname, 'src/widget.ts') },
      output: { entryFileNames: 'forms-widget.js', format: 'es', dir: 'dist' },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // Tests assert the injected reCAPTCHA <script> tag, not real execution.
    // Letting happy-dom fetch+run api.js throws an unhandled rejection that
    // fails the run, so keep external script files inert.
    environmentOptions: {
      happyDOM: { settings: { disableJavaScriptFileLoading: true } },
    },
  },
});
