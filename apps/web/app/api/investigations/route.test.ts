import { describe, expect, it } from 'vitest';
import { GET, POST } from './route';

const post = (body: unknown): Promise<Response> =>
  POST(
    new Request('http://localhost/api/investigations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('POST /api/investigations', () => {
  it('streams an SSE answer and closes with done', async () => {
    const res = await post({ question: "Why is ACME's ad bill higher this month than last?" });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text(); // reading to completion proves the stream closes
    expect(text).toContain('event: answer');
    expect(text.trimEnd().endsWith('event: done\ndata: {}')).toBe(true);
  });

  it('400s on a missing question', async () => {
    const res = await post({ dataSourceId: 'sample' });
    expect(res.status).toBe(400);
  });

  it('400s on a non-JSON body', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/investigations', () => {
  it('lists prior investigations', async () => {
    await post({ question: 'Top customers by spend last quarter?' });
    const res = await GET(new Request('http://localhost/api/investigations'));
    const list = (await res.json()) as unknown[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});
