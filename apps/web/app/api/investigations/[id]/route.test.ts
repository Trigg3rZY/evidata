import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/investigations/[id]', () => {
  it('404s for an unknown investigation', async () => {
    const res = await GET(new Request('http://localhost/api/investigations/nope'), {
      params: Promise.resolve({ id: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });
});
