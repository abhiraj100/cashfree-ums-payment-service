import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(frontendRoot),
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000', '/payment-return': 'http://localhost:3000' },
  },
});
