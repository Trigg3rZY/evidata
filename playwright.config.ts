import { defineConfig, devices } from '@playwright/test';

// M0 smoke suite (spec 06) is the acceptance gate. The web server wiring is
// added in a later phase once apps/web exists; for now this config defines the
// project so `pnpm e2e` is available and tests/smoke is the canonical location.
export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.smoke.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
