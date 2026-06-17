import { describe, expect, it } from 'vitest';

// Sanity test so the test runner and CI have a green baseline before real
// packages land (phase 2+). Replace/remove once package suites exist.
describe('monorepo skeleton', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2);
  });
});
