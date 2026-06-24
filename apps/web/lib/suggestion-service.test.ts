import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { AuthoringAccessError } from './authoring-service';
import {
  SuggestionService,
  SuggestionStateError,
  SuggestionValidationError,
} from './suggestion-service';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let svc: SuggestionService;

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  svc = new SuggestionService(store);

  await store.createFirstUser({
    id: 'owner',
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'x',
  });
  await store.createUser({
    id: 'quinn',
    username: 'quinn',
    displayName: 'Quinn',
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
    createdBy: 'owner',
  });
  await store.createDataSource({ id: 'ds-s', name: 'S', kind: 'postgres', connectionId: 'c1' });
  await store.createDataSourceMembership({
    id: 'dm-o',
    userId: 'owner',
    dataSourceId: 'ds-s',
    role: 'owner',
  });
  await store.createDataSourceMembership({
    id: 'dm-q',
    userId: 'quinn',
    dataSourceId: 'ds-s',
    role: 'querier',
  });
  await store.createInvestigation({ id: 'inv-s', dataSourceId: 'ds-s', title: 'blocked q' });
  await store.addGlossaryTerms([
    {
      id: 'gS1',
      dataSourceId: 'ds-s',
      term: 'active user',
      definition: 'draft',
      status: 'suggested',
      provenance: 'ai_draft',
    },
  ]);
  await store.addEntityMappings([
    {
      id: 'mS1',
      dataSourceId: 'ds-s',
      fromRef: 'invoices.customer_ref',
      toRef: 'accounts.id',
      status: 'suggested',
      provenance: 'ai_draft',
    },
  ]);
});

afterAll(async () => {
  await handle.close();
});

const submit = (kind = 'notify_admin_verify') =>
  svc.submit('quinn', 'inv-s', {
    kind,
    targetRef: 'invoices.customer_ref→accounts.id',
    description: 'This mapping is only Suggested.',
  });

describe('SuggestionService (M2-B4, #123)', () => {
  it('submit: a querier (member) can raise a correction from their blocked answer', async () => {
    const { id } = await submit();
    expect(typeof id).toBe('string');
    const rec = await store.getSuggestion(id);
    expect(rec).toMatchObject({
      investigationId: 'inv-s',
      dataSourceId: 'ds-s',
      submittedBy: 'quinn',
      answerVersion: null, // no answer persisted in this test
      status: 'open',
    });
  });

  it('submit: a non-member is rejected (404); an empty description is rejected (400)', async () => {
    await expect(
      svc.submit('stranger', 'inv-s', { kind: 'notify_admin_verify', description: 'x' }),
    ).rejects.toBeInstanceOf(AuthoringAccessError);
    await expect(
      svc.submit('quinn', 'inv-s', { kind: 'notify_admin_verify', description: '   ' }),
    ).rejects.toBeInstanceOf(SuggestionValidationError);
    await expect(
      svc.submit('quinn', 'nope', { kind: 'notify_admin_verify', description: 'x' }),
    ).rejects.toBeInstanceOf(AuthoringAccessError);
  });

  it('list: owner/admin sees the open queue (with submitter name); a querier cannot', async () => {
    const open = await svc.list('owner', 'ds-s');
    expect(open.length).toBeGreaterThan(0);
    expect(open[0]).toMatchObject({ submittedByName: 'Quinn', status: 'open' });
    // A querier has `query` but not `author` → 404.
    await expect(svc.list('quinn', 'ds-s')).rejects.toBeInstanceOf(AuthoringAccessError);
  });

  it('accept (mapping): promotes the chosen item to Verified, marks accepted, returns the investigation', async () => {
    const { id } = await submit();
    const res = await svc.accept('owner', 'ds-s', id, {
      targetKind: 'mapping',
      targetItemId: 'mS1',
    });
    expect(res).toEqual({ investigationId: 'inv-s', answerVersion: null });
    expect((await store.getEntityMappings('ds-s', 'verified')).some((m) => m.id === 'mS1')).toBe(
      true,
    );
    const rec = await store.getSuggestion(id);
    expect(rec).toMatchObject({
      status: 'accepted',
      targetKind: 'mapping',
      targetItemId: 'mS1',
      reviewedBy: 'owner',
    });
    // Re-accepting an already-reviewed suggestion is rejected (409).
    await expect(
      svc.accept('owner', 'ds-s', id, { targetKind: 'mapping', targetItemId: 'mS1' }),
    ).rejects.toBeInstanceOf(SuggestionStateError);
  });

  it('accept (glossary): applies the proposed definition, then verifies the term', async () => {
    const { id } = await svc.submit('quinn', 'inv-s', {
      kind: 'pick_definition',
      description: 'define active user',
      proposedDefinition: 'logged in within 30 days',
    });
    await svc.accept('owner', 'ds-s', id, {
      targetKind: 'glossary',
      targetItemId: 'gS1',
      definition: 'logged in within 30 days',
    });
    const term = (await store.getGlossaryTerms('ds-s')).find((t) => t.id === 'gS1');
    expect(term).toMatchObject({ status: 'verified', definition: 'logged in within 30 days' });
  });

  it('reject: marks the suggestion rejected without verifying anything', async () => {
    const { id } = await submit();
    await svc.reject('owner', 'ds-s', id);
    expect((await store.getSuggestion(id))?.status).toBe('rejected');
    // A querier cannot reject.
    const { id: id2 } = await submit();
    await expect(svc.reject('quinn', 'ds-s', id2)).rejects.toBeInstanceOf(AuthoringAccessError);
  });

  it('accept/reject are scoped: a suggestion id from another data source is not found (404)', async () => {
    const { id } = await submit();
    await expect(
      svc.accept('owner', 'other-ds', id, { targetKind: 'mapping', targetItemId: 'mS1' }),
    ).rejects.toBeInstanceOf(AuthoringAccessError);
  });
});
