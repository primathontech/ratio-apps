import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'RpPortal',
      fileName: 'rp-portal',
      formats: ['es'],
    },
    rollupOptions: {
      external: [],
    },
    minify: true,
    sourcemap: true,
  },
})
