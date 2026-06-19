import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import {
  AuthoringAccessError,
  AuthoringValidationError,
  DataSourceAuthoringService,
  PublishReadinessError,
} from './authoring-service';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
const DS = 'ds-auth';

let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let svc: DataSourceAuthoringService;

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  svc = new DataSourceAuthoringService(store);

  const owner = await store.createFirstUser({
    id: 'owner',
    email: 'o@x.com',
    displayName: 'Owner',
    passwordHash: 'x',
  });
  await store.createConnection({
    id: 'c-auth',
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
    id: 'm-auth',
    userId: 'owner',
    connectionId: 'c-auth',
    role: 'owner',
  });
  await store.saveSchemaSnapshot({
    id: 'snap-auth',
    connectionId: 'c-auth',
    status: 'complete',
    partial: false,
    payload: {
      dataSourceId: 'c-auth',
      capturedAt: '2026-06-19T00:00:00.000Z',
      partial: false,
      tables: [
        { name: 'customers', columns: [{ name: 'email', dataType: 'text', nullable: true }] },
        { name: 'orders', columns: [{ name: 'total', dataType: 'numeric', nullable: true }] },
      ],
    },
    capturedAt: new Date(),
  });
  // The draft Data Source that authoring edits (created with the connection in M1).
  await store.createDataSource({ id: DS, name: 'PG', kind: 'postgres', connectionId: 'c-auth' });
});

afterAll(async () => {
  await handle.close();
});

const draft = () => ({
  includedTables: ['customers'],
  sensitiveColumns: ['customers.email'],
  overview: 'Customer + order data.',
  policy: {
    rowLimit: 500,
    timeoutMs: 8000,
    statementTimeoutMs: null,
    confirmOnBroadScan: true,
    confirmOnSensitiveAccess: false,
  },
});

describe('DataSourceAuthoringService (M2-S3, spec 09 §5/§7)', () => {
  it('lists the owner’s authorable sources (incl. drafts); nothing for a stranger', async () => {
    const mine = await svc.listAuthorable('owner');
    expect(mine.some((d) => d.id === DS)).toBe(true);
    expect(await svc.listAuthorable('stranger')).toEqual([]);
  });

  it('owner-gates editing on the backing connection membership', async () => {
    await expect(svc.getEditable('stranger', DS)).rejects.toBeInstanceOf(AuthoringAccessError);
    await expect(svc.getEditable('owner', 'ghost')).rejects.toBeInstanceOf(AuthoringAccessError);
    const e = await svc.getEditable('owner', DS);
    expect(e.lifecycle).toBe('draft');
    expect(e.schema?.tables.map((t) => t.name)).toEqual(['customers', 'orders']);
    expect(e.includedTables).toEqual([]); // nothing scoped yet
    expect(e.policy.rowLimit).toBe(1000); // strict defaults
    expect(e.readiness.ready).toBe(false);
    expect(e.readiness.missing).toContain('at least one included table');
  });

  it('refuses to publish a draft that fails the readiness checklist', async () => {
    await expect(svc.publish('owner', DS)).rejects.toBeInstanceOf(PublishReadinessError);
  });

  it('saves the draft (rejecting unknown tables) and reflects it back', async () => {
    await expect(
      svc.save('owner', DS, { ...draft(), includedTables: ['nope'] }),
    ).rejects.toBeInstanceOf(AuthoringValidationError);

    await svc.save('owner', DS, draft());
    const e = await svc.getEditable('owner', DS);
    expect(e.includedTables).toEqual(['customers']);
    expect(e.sensitiveColumns).toEqual(['customers.email']);
    expect(e.overview).toBe('Customer + order data.');
    expect(e.policy).toMatchObject({ rowLimit: 500, confirmOnSensitiveAccess: false });
    expect(e.readiness.ready).toBe(true);
  });

  it('publishes a ready draft and can pull it back to draft', async () => {
    await svc.publish('owner', DS);
    expect((await store.getDataSource(DS))?.lifecycle).toBe('published');

    await svc.unpublish('owner', DS);
    expect((await store.getDataSource(DS))?.lifecycle).toBe('draft');
  });

  it('auto-demotes a published source whose edit makes it not-ready (Codex P2)', async () => {
    await svc.save('owner', DS, draft());
    await svc.publish('owner', DS);
    expect((await store.getDataSource(DS))?.lifecycle).toBe('published');

    // Removing the last included table breaks readiness → must fall back to draft.
    await svc.save('owner', DS, { ...draft(), includedTables: [], sensitiveColumns: [] });
    expect((await store.getDataSource(DS))?.lifecycle).toBe('draft');
  });
});
