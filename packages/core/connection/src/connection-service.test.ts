/**
 * ConnectionService integration tests (spec 08 §6/§11) against a REAL Postgres +
 * the real pglite metadata store + a real CredentialVault. Gated on
 * TEST_DATABASE_URL; skipped otherwise so `pnpm test` stays hermetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { credentialVaultFromEnv } from '@evidata/secrets';
import { ConnectionAccessError, ConnectionService } from './connection-service';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const run = describe.skipIf(!ADMIN_URL);
const RO = { user: 'conn_ro_test', password: 'ro-pw' };

run('ConnectionService (real Postgres + store + vault)', () => {
  let handle: MetadataDbHandle;
  let svc: ConnectionService;
  let admin: Client;
  let pg: { host: string; port: number; database: string };
  let ownerId: string;

  beforeAll(async () => {
    const url = new URL(ADMIN_URL as string);
    pg = { host: url.hostname, port: Number(url.port) || 5432, database: url.pathname.slice(1) };

    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // A genuine read-only role (no DATABASE CREATE → probe reports Healthy).
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RO.user}') THEN
        CREATE ROLE ${RO.user} LOGIN PASSWORD '${RO.password}';
      END IF;
    END $$;`);
    await admin.query(`GRANT CONNECT ON DATABASE ${pg.database} TO ${RO.user}`);

    handle = await createMetadataDb();
    const store = new DrizzleMetadataStore(handle.db);
    const vault = credentialVaultFromEnv({
      APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    svc = new ConnectionService({ store, vault });

    const owner = await store.createFirstUser({
      id: 'owner',
      username: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: 'x',
    });
    ownerId = owner!.id;
  });

  afterAll(async () => {
    await handle?.close();
    if (admin) await admin.end();
  });

  const make = (over: Partial<{ user: string; password: string }> = {}) =>
    svc.create(ownerId, {
      name: 'Test DB',
      host: pg.host,
      port: pg.port,
      database: pg.database,
      sslMode: 'disable',
      user: over.user ?? RO.user,
      password: over.password ?? RO.password,
    });

  it('create() encrypts credentials and never returns the blob', async () => {
    const summary = await make();
    expect(summary.name).toBe('Test DB');
    expect(summary.health).toBe('Untested');
    expect((summary as { credentialBlob?: unknown }).credentialBlob).toBeUndefined();
    // Owner can read it back; a stranger cannot tell it exists.
    expect((await svc.get(ownerId, summary.id)).id).toBe(summary.id);
    await expect(svc.get('stranger', summary.id)).rejects.toBeInstanceOf(ConnectionAccessError);
  });

  it('test() reports Healthy (read-only role), AuthFailed (bad creds), PermissionInsufficient (write-capable)', async () => {
    const healthy = await make();
    expect((await svc.test(ownerId, healthy.id)).health).toBe('Healthy');

    const bad = await make({ password: 'wrong-password' });
    expect((await svc.test(ownerId, bad.id)).health).toBe('AuthFailed');

    // The admin (superuser) role can write → flagged, not blocked.
    const url = new URL(ADMIN_URL as string);
    const writable = await make({ user: url.username, password: url.password });
    expect((await svc.test(ownerId, writable.id)).health).toBe('PermissionInsufficient');
  });

  it('testDraft() probes unsaved params and update() re-encrypts saved credentials', async () => {
    expect(
      (
        await svc.testDraft({
          name: 'Draft',
          host: pg.host,
          port: pg.port,
          database: pg.database,
          sslMode: 'disable',
          user: RO.user,
          password: RO.password,
        })
      ).health,
    ).toBe('Healthy');

    const conn = await make({ password: 'wrong-password' });
    expect((await svc.test(ownerId, conn.id)).health).toBe('AuthFailed');
    await svc.update(ownerId, conn.id, { password: RO.password });
    expect((await svc.test(ownerId, conn.id)).health).toBe('Healthy');
  });

  it('list() returns only the caller’s connections', async () => {
    await make();
    expect((await svc.list(ownerId)).length).toBeGreaterThan(0);
    expect(await svc.list('stranger')).toEqual([]);
  });

  it('introspect() captures + stores a schema snapshot', async () => {
    const conn = await make();
    const result = await svc.introspect(ownerId, conn.id);
    expect(result.tableCount).toBeGreaterThanOrEqual(0);
    expect(result.capturedAt).toBeTruthy();
  });

  it('remove() reports affected data sources and deletes the connection', async () => {
    const conn = await make();
    const { affectedDataSources } = await svc.remove(ownerId, conn.id);
    expect(affectedDataSources.length).toBe(1); // the minimal data source created on create()
    await expect(svc.get(ownerId, conn.id)).rejects.toBeInstanceOf(ConnectionAccessError);
  });
});

// Non-gated (metadata-only; create() makes no network call): the M2-B1a bootstrap —
// creating a Connection grants the creator an owner role on the auto-created source.
describe('ConnectionService bootstrap (M2-B1a, #121)', () => {
  it('grants the creator a Data Source owner role on the new draft source', async () => {
    const handle = await createMetadataDb();
    const store = new DrizzleMetadataStore(handle.db);
    const vault = credentialVaultFromEnv({
      APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    const svc = new ConnectionService({ store, vault });
    await store.createFirstUser({ id: 'u1', username: 'u1', displayName: 'U', passwordHash: 'x' });

    await svc.create('u1', {
      name: 'DB',
      host: 'h',
      port: 5432,
      database: 'd',
      sslMode: 'disable',
      user: 'ro',
      password: 'pw',
    });

    const memberships = await store.listDataSourceMemberships('u1');
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('owner');
    expect(await store.getDataSourceRole('u1', memberships[0]!.dataSourceId)).toBe('owner');
    await handle.close();
  });

  it('update() edits in place, keeps the draft source, and preserves authz', async () => {
    const handle = await createMetadataDb();
    const store = new DrizzleMetadataStore(handle.db);
    const vault = credentialVaultFromEnv({
      APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    const svc = new ConnectionService({ store, vault });
    await store.createFirstUser({ id: 'u2', username: 'u2', displayName: 'U2', passwordHash: 'x' });
    const conn = await svc.create('u2', {
      name: 'DB',
      host: 'h',
      port: 5432,
      database: 'd',
      sslMode: 'disable',
      user: 'ro',
      password: 'pw',
    });
    await store.setConnectionHealth(conn.id, 'Healthy');
    const before = await store.getConnection(conn.id);
    const sources = await store.listDataSourcesByConnection(conn.id);

    const updated = await svc.update('u2', conn.id, { host: 'h2', password: 'pw2' });

    expect(updated).toMatchObject({ id: conn.id, host: 'h2', health: 'Untested' });
    expect(await store.listDataSourcesByConnection(conn.id)).toEqual(sources);
    expect((await store.getConnection(conn.id))?.credentialBlob).not.toEqual(
      before?.credentialBlob,
    );
    await expect(svc.update('stranger', conn.id, { host: 'x' })).rejects.toBeInstanceOf(
      ConnectionAccessError,
    );
    await expect(svc.testPatch('stranger', conn.id, { host: 'x' })).rejects.toBeInstanceOf(
      ConnectionAccessError,
    );
    await handle.close();
  });
});
