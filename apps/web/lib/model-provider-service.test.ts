import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { credentialVaultFromEnv } from '@evidata/secrets';
import {
  ModelProviderAccessError,
  ModelProviderService,
  VaultUnavailableError,
  type CreateModelProviderInput,
} from './model-provider-service';

let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
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

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  const vault = credentialVaultFromEnv({ APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
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
    expect((await svc.list('owner')).some((p) => p.id === summary.id)).toBe(true);

    await svc.remove('owner', summary.id);
    expect(await store.getModelProvider(summary.id)).toBeNull();
  });

  it('scopes providers per user: a non-owner can neither see nor delete them', async () => {
    const mine = await svc.create('owner', input({ name: 'Mine' }));
    // A different user doesn't see it and can't delete it.
    expect((await svc.list('stranger')).some((p) => p.id === mine.id)).toBe(false);
    await expect(svc.remove('stranger', mine.id)).rejects.toBeInstanceOf(ModelProviderAccessError);
    // The owner still can.
    expect((await svc.list('owner')).some((p) => p.id === mine.id)).toBe(true);
    await svc.remove('owner', mine.id);
  });

  it('errors clearly when no credential vault is configured', async () => {
    const noVault = new ModelProviderService({ store, vault: null });
    await expect(noVault.create('owner', input())).rejects.toBeInstanceOf(VaultUnavailableError);
  });
});
