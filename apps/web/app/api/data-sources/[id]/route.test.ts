import { describe, expect, it } from 'vitest';
import type { DataSourceOverview } from '@evidata/investigation';
import { GET } from './route';

describe('GET /api/data-sources/[id]', () => {
  it('404s for an unknown data source', async () => {
    const res = await GET(new Request('http://localhost/api/data-sources/nope'), {
      params: Promise.resolve({ id: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns the sample overview — schema + safety posture, no internals', async () => {
    const res = await GET(new Request('http://localhost/api/data-sources/sample'), {
      params: Promise.resolve({ id: 'sample' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataSourceOverview;
    expect(body.id).toBe('sample');
    expect(body.safety.readOnly).toBe(true);
    expect(body.safety.rowLimit).toBe(1000);
    expect(body.safety.redactedColumns).toContain('accounts.contact_email');
    expect(body.schema.tables.length).toBeGreaterThan(0);
    // No credential/connector internals leak into the overview.
    expect(JSON.stringify(body)).not.toMatch(/password|credential|connector|executor/i);
  });
});
