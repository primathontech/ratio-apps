import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Claim-widget build: **classic IIFE** script (`src/claim-widget.ts`), Lit
// bundled and self-contained. It is intentionally NOT an ESM module: the loader
// injects it as a plain `<script src>` (no `type="module"`), so it loads
// cross-origin exactly like the loader — no CORS-mode fetch, and it survives
// storefront service workers that mishandle cross-origin module requests
// (a classic script is fetched no-cors and executes even behind a SW cache).
// The `@customElement('loyalty-claim-widget')` decorator self-registers the
// element on execution, upgrading any element the loader already appended.
// The loader (also IIFE) is built by a second pass via `vite.loader.config.ts`.
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: true,
    rollupOptions: {
      input: { 'loyalty-claim': resolve(__dirname, 'src/claim-widget.ts') },
      output: {
        entryFileNames: 'loyalty-claim.js',
        format: 'iife',
        name: 'RatioLoyaltyClaim',
        dir: 'dist',
      },
    },
  },
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
});
