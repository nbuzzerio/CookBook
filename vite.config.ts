import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/apps/recipes/' : '/',
  plugins: [react(), tailwindcss()],
  server: { proxy: process.env.COUNTERTOP_LOCAL_PSS === '1' ? { '/api/v1': { target: 'http://127.0.0.1:4317', changeOrigin: false } } : undefined, watch: { ignored: ['**/.qa/**', '**/test-results/**', '**/playwright-report/**'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
}));
