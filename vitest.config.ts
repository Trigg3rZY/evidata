import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror apps/web's "@/*" path alias so its lib tests resolve.
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    // Unit tests live next to source (packages/** and apps/web/**) and under tests/unit.
    // Playwright owns tests/smoke, so exclude it from Vitest.
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/web/**/*.{test,spec}.ts',
      'tests/unit/**/*.{test,spec}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'tests/smoke/**'],
  },
});
