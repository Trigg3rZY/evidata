import { defineConfig, devices } from '@playwright/test';

// M0 smoke suite (spec 06) — the acceptance gate. Builds and serves apps/web,
// then drives the real Ask Data loop in a browser.
const PORT = 3210;

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.smoke.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm --filter @evidata/web build && pnpm --filter @evidata/web start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
