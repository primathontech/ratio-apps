import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
    console.log(`[vite] loaded env from ${filePath}${override ? ' (override)' : ''}`);
  } catch {
  }
}

export default defineConfig({
  base: './',
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5175,
    proxy: {
      '/unicommerce/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/unicommerce/auth': { target: 'http://localhost:3000', changeOrigin: true },
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
