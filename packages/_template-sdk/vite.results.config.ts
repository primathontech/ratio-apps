import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Results build: ESM module entry (`src/results.ts`), single input.
// Runs as the THIRD build pass after the widget and loader builds. emptyOutDir
// is disabled so it does not wipe the widget/loader artifacts. Shipping the
// results page as its own bundle keeps it out of the overlay widget graph so
// `__slug__-widget.js` stays small.
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: false,
    rollupOptions: {
      input: { '__slug__-results': resolve(__dirname, 'src/results.ts') },
      output: {
        entryFileNames: '__slug__-results.js',
        format: 'es',
        dir: 'dist',
      },
    },
  },
});
