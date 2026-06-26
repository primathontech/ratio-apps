import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Loader build: IIFE bootstrap script (`src/loader.ts`), single input.
// Runs as the SECOND build pass after the widget build. emptyOutDir is
// disabled so it does not wipe the widget artifact emitted by the first pass.
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: false,
    rollupOptions: {
      input: { 'wizzy-loader': resolve(__dirname, 'src/loader.ts') },
      output: {
        entryFileNames: 'wizzy-loader.js',
        format: 'iife',
        name: 'WizzyLoader',
        dir: 'dist',
      },
    },
  },
});
