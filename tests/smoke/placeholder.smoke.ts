import { test } from '@playwright/test';

// The real M0 acceptance smoke suite (spec 06) is wired up once apps/web exists.
// This placeholder keeps `pnpm e2e` runnable and marks where the gate will live.
test.skip('M0 smoke suite — added with apps/web (spec 06)', () => {});
