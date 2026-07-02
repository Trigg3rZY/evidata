import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { credentialVaultFromEnv } from '@evidata/secrets';
import type { CredentialVault } from '@evidata/ports';
import {
  ModelProviderAccessError,
  ModelProviderService,
  VaultUnavailableError,
  type CreateModelProviderInput,
} from './model-provider-service';

let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let vault: CredentialVault;
let svc: ModelProviderService;

const input = (over: Partial<CreateModelProviderInput> = {}): CreateModelProviderInput => ({
  name: 'Team DeepSeek',
  kind: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  params: { temperature: 0, effort: 'low' },
  capabilities: { toolChoice: 'required' },
  apiKey: 'sk-secret-123',
  ...over,
});

/** A typed fetch stub for the reachability probe: `respond` returns the canned
 *  Response (or throws to simulate a network failure → a rejected promise). */
function fetchStub(respond: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (info, init) => {
    const url = typeof info === 'string' ? info : info instanceof URL ? info.href : info.url;
    try {
      return Promise.resolve(respond(url, init));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };
}

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  vault = credentialVaultFromEnv({ APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
  svc = new ModelProviderService({ store, vault });
  await store.createFirstUser({
    id: 'owner',
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'x',
  });
});

afterAll(async () => {
  await handle.close();
});

describe('ModelProviderService (epic #106)', () => {
  it('encrypts the key on create; summaries omit it; apiKeyFor round-trips; delete removes it', async () => {
    const summary = await svc.create('owner', input());
    expect(summary.name).toBe('Team DeepSeek');
    expect(summary.model).toBe('deepseek-chat');
    expect(summary.capabilities).toEqual({ toolChoice: 'required' });
    // The key never leaves via the summary.
    expect((summary as Record<string, unknown>).credentialBlob).toBeUndefined();
    expect((summary as Record<string, unknown>).apiKey).toBeUndefined();

    // Stored blob is NOT the plaintext key.
    const stored = await store.getModelProvider(summary.id);
    expect(JSON.stringify(stored?.credentialBlob)).not.toContain('sk-secret-123');

    // The service can decrypt it for the internal resolve path.
    expect(await svc.apiKeyFor(summary.id)).toBe('sk-secret-123');
    expect(await svc.apiKeyFor('nope')).toBeNull();

    // Listed as a summary (no blob) for the owner.
    expect((await svc.list()).some((p) => p.id === summary.id)).toBe(true);

    await svc.remove('owner', summary.id);
    expect(await store.getModelProvider(summary.id)).toBeNull();
  });

  it('shares the pool: any member sees every model; only the creator may delete (#151)', async () => {
    const mine = await svc.create('owner', input({ name: 'Mine' }));
    // Shared: a different member sees it in the pool…
    expect((await svc.list()).some((p) => p.id === mine.id)).toBe(true);
    // …but cannot delete it (creator-only guard, so one member can't break the pool).
    await expect(svc.remove('stranger', mine.id)).rejects.toBeInstanceOf(ModelProviderAccessError);
    // The member who configured it can.
    await svc.remove('owner', mine.id);
    expect((await svc.list()).some((p) => p.id === mine.id)).toBe(false);
  });

  it('errors clearly when no credential vault is configured', async () => {
    const noVault = new ModelProviderService({ store, vault: null });
    await expect(noVault.create('owner', input())).rejects.toBeInstanceOf(VaultUnavailableError);
  });

  it('resolveConfig returns a runnable config (decrypted) for any member — shared (#151)', async () => {
    const p = await svc.create(
      'owner',
      input({ name: 'Runnable', baseUrl: null, kind: 'deepseek' }),
    );
    const cfg = await svc.resolveConfig(p.id);
    expect(cfg).toMatchObject({
      apiKey: 'sk-secret-123', // decrypted
      baseURL: 'https://api.deepseek.com', // default for the kind (baseUrl was null)
      model: 'deepseek-chat',
    });
    // Unknown id → null (no run). Shared: there's no per-user gate to fail.
    expect(await svc.resolveConfig('nope')).toBeNull();
    await svc.remove('owner', p.id);
  });

  it('list flags runnability: a vendor default or explicit base is runnable, none is not', async () => {
    const ok = await svc.create(
      'owner',
      input({ name: 'HasDefault', kind: 'deepseek', baseUrl: null }),
    );
    const noBase = await svc.create(
      'owner',
      input({ name: 'NoBaseList', kind: 'openai-compatible', baseUrl: null }),
    );
    const list = await svc.list();
    expect(list.find((p) => p.id === ok.id)?.runnable).toBe(true); // deepseek default base
    expect(list.find((p) => p.id === noBase.id)?.runnable).toBe(false); // no resolvable base
    await svc.remove('owner', ok.id);
    await svc.remove('owner', noBase.id);
  });

  it('resolveDefaultConfig selects a runnable registered model (#170)', async () => {
    const noBase = await svc.create(
      'owner',
      input({ name: 'DefaultSkip', kind: 'openai-compatible', baseUrl: null }),
    );
    const runnable = await svc.create(
      'owner',
      input({ name: 'DefaultRun', kind: 'deepseek', baseUrl: null }),
    );

    const resolved = await svc.resolveDefaultConfig();
    expect(resolved?.id).toBe(runnable.id);
    expect(resolved?.config).toMatchObject({
      apiKey: 'sk-secret-123',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });

    await svc.remove('owner', noBase.id);
    await svc.remove('owner', runnable.id);
  });

  it('resolveConfig carries effort only for an effort-capable kind', async () => {
    // OpenAI kind supports reasoning_effort → effort flows into the config.
    const oa = await svc.create(
      'owner',
      input({ name: 'OpenAI', kind: 'openai', baseUrl: null, params: { effort: 'low' } }),
    );
    expect((await svc.resolveConfig(oa.id))?.effort).toBe('low');
    await svc.remove('owner', oa.id);

    // A non-effort kind that somehow carries effort (e.g. a record predating the gate)
    // never sends it — resolveConfig drops it defensively.
    const ds = await svc.create(
      'owner',
      input({ name: 'DeepSeek effort', kind: 'deepseek', params: { effort: 'high' } }),
    );
    expect((await svc.resolveConfig(ds.id))?.effort).toBeUndefined();
    await svc.remove('owner', ds.id);

    // An effort-capable kind carrying an INVALID legacy value (effort was once free
    // text) drops it rather than sending a value the provider would reject.
    const bad = await svc.create(
      'owner',
      input({
        name: 'OpenAI bad effort',
        kind: 'openai',
        baseUrl: null,
        params: { effort: 'extreme' },
      }),
    );
    expect((await svc.resolveConfig(bad.id))?.effort).toBeUndefined();
    await svc.remove('owner', bad.id);
  });

  it('resolveConfig is null when no OpenAI-compatible base can be determined', async () => {
    // openai-compatible kind with no baseUrl → not runnable yet.
    const p = await svc.create(
      'owner',
      input({ name: 'NoBase', kind: 'openai-compatible', baseUrl: null }),
    );
    expect(await svc.resolveConfig(p.id)).toBeNull();
    await svc.remove('owner', p.id);
  });

  it('test() probes GET {base}/models with the decrypted key and maps the outcome (#119)', async () => {
    let lastUrl = '';
    let lastAuth: string | undefined;
    const fetchImpl = fetchStub((url, init) => {
      lastUrl = url;
      lastAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return new Response('{"data":[]}', { status: 200 });
    });
    const probeSvc = new ModelProviderService({ store, vault, fetchImpl });
    const p = await svc.create('owner', input({ name: 'Probe', kind: 'deepseek', baseUrl: null }));

    expect(await probeSvc.test(p.id)).toEqual({ status: 'ok' });
    // Cheap, token-free GET against the vendor-default base, with the (decrypted) key.
    expect(lastUrl).toBe('https://api.deepseek.com/models');
    expect(lastAuth).toBe('Bearer sk-secret-123');

    // Shared (#151): any member may probe; an unknown id still 404s (no leak).
    await expect(probeSvc.test('nope')).rejects.toBeInstanceOf(ModelProviderAccessError);
    await svc.remove('owner', p.id);
  });

  it('test() reports unauthorized / unreachable / unconfigured (#119)', async () => {
    const p = await svc.create('owner', input({ name: 'Auth', kind: 'deepseek', baseUrl: null }));

    const reject = new ModelProviderService({
      store,
      vault,
      fetchImpl: fetchStub(() => new Response(null, { status: 401 })),
    });
    expect(await reject.test(p.id)).toEqual({ status: 'unauthorized', httpStatus: 401 });

    const down = new ModelProviderService({
      store,
      vault,
      fetchImpl: fetchStub(() => {
        throw new Error('network down'); // must collapse to a coarse status, never leak
      }),
    });
    expect(await down.test(p.id)).toEqual({ status: 'unreachable' });
    await svc.remove('owner', p.id);

    // No base URL resolves → nothing to probe; never calls fetch.
    let called = false;
    const unconfigured = new ModelProviderService({
      store,
      vault,
      fetchImpl: fetchStub(() => {
        called = true;
        return new Response(null, { status: 200 });
      }),
    });
    const nb = await svc.create(
      'owner',
      input({ name: 'NoBaseProbe', kind: 'openai-compatible', baseUrl: null }),
    );
    expect(await unconfigured.test(nb.id)).toEqual({ status: 'unconfigured' });
    expect(called).toBe(false);
    await svc.remove('owner', nb.id);
  });
});
