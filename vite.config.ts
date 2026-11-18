import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { watch: { ignored: ['**/.qa/**', '**/test-results/**', '**/playwright-report/**'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
