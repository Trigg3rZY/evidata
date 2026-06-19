import { describe, expect, it } from 'vitest';
import { GET as listGET, POST as createPOST } from './route';
import { DELETE as delDELETE, GET as getGET } from './[id]/route';
import { POST as testPOST } from './[id]/test/route';
import { POST as introspectPOST } from './[id]/introspect/route';

// Connection management requires a session — without a cookie every route is 401.
// (The happy paths are covered by the ConnectionService integration test.)
const anon = (method: string): Request => new Request('http://localhost', { method });
const params = Promise.resolve({ id: 'conn_x' });

describe('connection routes require authentication', () => {
  it('401s without a session cookie', async () => {
    expect((await listGET(anon('GET'))).status).toBe(401);
    expect((await createPOST(anon('POST'))).status).toBe(401);
    expect((await getGET(anon('GET'), { params })).status).toBe(401);
    expect((await delDELETE(anon('DELETE'), { params })).status).toBe(401);
    expect((await testPOST(anon('POST'), { params })).status).toBe(401);
    expect((await introspectPOST(anon('POST'), { params })).status).toBe(401);
  });
});
