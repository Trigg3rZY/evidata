import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Unit tests live next to source (packages/**) and under tests/unit.
    // Playwright owns tests/smoke, so exclude it from Vitest.
    include: ['packages/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/smoke/**'],
  },
});
