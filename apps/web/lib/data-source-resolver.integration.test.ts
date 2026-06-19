/**
 * M2-S2 end-to-end payoff (spec 09 §2/§9) against a REAL Postgres: create a
 * Connection (encrypted creds) → introspect → publish a DataSource bound to a
 * table → resolve it into a runtime → the read-only connector actually queries
 * the real database, and a write is rejected. Gated on TEST_DATABASE_URL; skipped
 * otherwise so `pnpm test` stays hermetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createMetadataDb,
  DrizzleMetadataStore,
  dataSourceConnections,
  dataSources,
  policies,
  type MetadataDbHandle,
} from '@evidata/db';
import { credentialVaultFromEnv } from '@evidata/secrets';
import { ConnectionService } from '@evidata/connection';
import { PublishedDataSourceResolver } from './data-source-resolver';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const run = describe.skipIf(!ADMIN_URL);
const RO = { user: 'conn_ro_m2', password: 'ro-pw' };
const DS_ID = 'ds-m2-int';

run('PublishedDataSourceResolver → real Postgres (M2-S2)', () => {
  let handle: MetadataDbHandle;
  let store: DrizzleMetadataStore;
  let svc: ConnectionService;
  let resolver: PublishedDataSourceResolver;
  let admin: Client;
  let pg: { host: string; port: number; database: string };
  let ownerId: string;

  beforeAll(async () => {
    const url = new URL(ADMIN_URL as string);
    pg = { host: url.hostname, port: Number(url.port) || 5432, database: url.pathname.slice(1) };

    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // A read-only role + a table it may SELECT (its own scope; nothing else writable).
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RO.user}') THEN
        CREATE ROLE ${RO.user} LOGIN PASSWORD '${RO.password}';
      END IF;
    END $$;`);
    await admin.query(`GRANT CONNECT ON DATABASE ${pg.database} TO ${RO.user}`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${RO.user}`);
    await admin.query(
      `CREATE TABLE IF NOT EXISTS m2_widgets (id int PRIMARY KEY, name text NOT NULL)`,
    );
    await admin.query(`TRUNCATE m2_widgets`);
    await admin.query(`INSERT INTO m2_widgets (id, name) VALUES (1, 'alpha'), (2, 'beta')`);
    await admin.query(`GRANT SELECT ON m2_widgets TO ${RO.user}`);

    handle = await createMetadataDb();
    store = new DrizzleMetadataStore(handle.db);
    const vault = credentialVaultFromEnv({
      APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    svc = new ConnectionService({ store, vault });
    resolver = new PublishedDataSourceResolver(store, svc, new Set(['sample']));

    const owner = await store.createFirstUser({
      id: 'owner',
      username: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: 'x',
    });
    ownerId = owner!.id;
  });

  afterAll(async () => {
    await svc?.closeAll();
    await handle?.close();
    if (admin) {
      await admin.query(`REVOKE ALL ON m2_widgets FROM ${RO.user}`).catch(() => {});
      await admin.query(`DROP TABLE IF EXISTS m2_widgets`).catch(() => {});
      await admin.end();
    }
  });

  it('publishes a real source, resolves it, and queries Postgres read-only', async () => {
    // Create the connection (read-only creds, encrypted) + capture its schema.
    const conn = await svc.create(ownerId, {
      name: 'Widgets DB',
      host: pg.host,
      port: pg.port,
      database: pg.database,
      sslMode: 'disable',
      user: RO.user,
      password: RO.password,
    });
    await svc.introspect(ownerId, conn.id);

    // Publish a DataSource bound to the connection, scoped to m2_widgets, with a Policy.
    const now = new Date();
    await handle.db.insert(dataSources).values({
      id: DS_ID,
      name: 'Widgets',
      kind: 'postgres',
      connectionId: conn.id,
      lifecycle: 'published',
      createdAt: now,
    });
    await handle.db.insert(dataSourceConnections).values({
      id: 'dsc-int',
      dataSourceId: DS_ID,
      connectionId: conn.id,
      alias: null,
      includedTables: ['m2_widgets'],
      fieldRules: {},
      createdAt: now,
    });
    await handle.db.insert(policies).values({
      id: 'pol-int',
      dataSourceId: DS_ID,
      rowLimit: 1000,
      timeoutMs: 5000,
      statementTimeoutMs: null,
      confirmOnBroadScan: false,
      confirmOnSensitiveAccess: false,
      updatedAt: now,
    });

    // Resolve as the owner (who has a membership on the backing connection).
    const rt = await resolver.resolve(DS_ID, ownerId);
    expect(rt).not.toBeNull();
    expect([...rt!.safetyContext.allowedTables]).toContain('m2_widgets');
    expect(rt!.schema.tables.some((t) => t.name === 'm2_widgets')).toBe(true);
    // It shows up in the owner's picker, but not for a non-member / anonymous.
    expect((await resolver.list(ownerId)).some((d) => d.id === DS_ID)).toBe(true);
    expect(await resolver.list('stranger')).toEqual([]);
    expect(await resolver.resolve(DS_ID)).toBeNull(); // anonymous is denied

    // The connector runs a real read-only SELECT against Postgres.
    const exec = rt!.connector.getExecutor();
    const res = await exec.run('SELECT id, name FROM m2_widgets ORDER BY id', {
      rowLimit: 1000,
      timeoutMs: 5000,
    });
    expect(res.rows).toEqual([
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]);

    // A write is rejected (read-only role + read-only transaction).
    await expect(
      exec.run("INSERT INTO m2_widgets (id, name) VALUES (3, 'gamma')", {
        rowLimit: 1000,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });
});
