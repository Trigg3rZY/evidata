import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { AuthoringAccessError } from './authoring-service';
import { VerificationService, VerificationValidationError } from './verification-service';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let svc: VerificationService;

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  svc = new VerificationService(store);
  const owner = await store.createFirstUser({
    id: 'owner',
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'x',
  });
  await store.createConnection({
    id: 'c1',
    kind: 'postgres',
    name: 'PG',
    host: 'h',
    port: 5432,
    database: 'd',
    sslMode: 'disable',
    credentialBlob: blob,
    health: 'Healthy',
    createdBy: owner!.id,
  });
  await store.createConnectionMembership({
    id: 'm1',
    userId: 'owner',
    connectionId: 'c1',
    role: 'owner',
  });
  await store.createDataSource({ id: 'ds-a', name: 'A', kind: 'postgres', connectionId: 'c1' });
  await store.createDataSource({ id: 'ds-b', name: 'B', kind: 'postgres', connectionId: 'c1' });

  // Seed: ds-a has a suggested + a verified term, a suggested mapping; ds-b a suggested term.
  await store.addGlossaryTerms([
    {
      id: 'gA1',
      dataSourceId: 'ds-a',
      term: 'spend',
      definition: 'draft',
      status: 'suggested',
      provenance: 'ai_draft',
    },
    {
      id: 'gA2',
      dataSourceId: 'ds-a',
      term: 'mrr',
      definition: 'ok',
      status: 'verified',
      provenance: 'admin',
    },
    {
      id: 'gB1',
      dataSourceId: 'ds-b',
      term: 'churn',
      definition: 'draft',
      status: 'suggested',
      provenance: 'ai_draft',
    },
  ]);
  await store.addEntityMappings([
    {
      id: 'mA1',
      dataSourceId: 'ds-a',
      fromRef: 'Cust',
      toRef: 'customers.id',
      status: 'suggested',
      provenance: 'ai_draft',
    },
  ]);
});

afterAll(async () => {
  await handle.close();
});

const status = async (ds: string, id: string): Promise<string | undefined> =>
  (await store.getGlossaryTerms(ds)).find((t) => t.id === id)?.status;

describe('VerificationService (M2-B3, #122)', () => {
  it('lists glossary + mappings with ids and statuses', async () => {
    const items = await svc.list('owner', 'ds-a');
    expect(items.glossary.map((g) => g.id).sort()).toEqual(['gA1', 'gA2']);
    expect(items.mappings.map((m) => m.id)).toEqual(['mA1']);
  });

  it('promotes a Suggested glossary term + mapping to Verified', async () => {
    await svc.promote('owner', 'ds-a', 'glossary', 'gA1');
    expect(await status('ds-a', 'gA1')).toBe('verified');
    await svc.promote('owner', 'ds-a', 'mapping', 'mA1');
    expect((await store.getEntityMappings('ds-a', 'verified')).some((m) => m.id === 'mA1')).toBe(
      true,
    );
  });

  it('edits a glossary definition; rejects an empty one', async () => {
    await svc.editGlossary('owner', 'ds-a', 'gA2', '  refined  ');
    expect((await store.getGlossaryTerms('ds-a')).find((t) => t.id === 'gA2')?.definition).toBe(
      'refined',
    );
    await expect(svc.editGlossary('owner', 'ds-a', 'gA2', '   ')).rejects.toBeInstanceOf(
      VerificationValidationError,
    );
  });

  it('scopes mutations by dataSourceId — an id from another source is a no-op', async () => {
    // Promote ds-b's term while addressing ds-a → must NOT change ds-b's term.
    await svc.promote('owner', 'ds-a', 'glossary', 'gB1');
    expect(await status('ds-b', 'gB1')).toBe('suggested');
  });

  it('rejects (deletes) an item', async () => {
    await store.addGlossaryTerms([
      {
        id: 'gDel',
        dataSourceId: 'ds-a',
        term: 'temp',
        definition: 'x',
        status: 'suggested',
        provenance: 'ai_draft',
      },
    ]);
    await svc.reject('owner', 'ds-a', 'glossary', 'gDel');
    expect((await store.getGlossaryTerms('ds-a')).some((t) => t.id === 'gDel')).toBe(false);
  });

  it('owner-gates: a non-member is rejected (404)', async () => {
    await expect(svc.list('stranger', 'ds-a')).rejects.toBeInstanceOf(AuthoringAccessError);
    await expect(svc.promote('stranger', 'ds-a', 'glossary', 'gA1')).rejects.toBeInstanceOf(
      AuthoringAccessError,
    );
  });
});
