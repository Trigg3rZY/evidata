/**
 * Integration tests for IntrospectionService against a REAL Postgres (spec 08 §11).
 * Gated on TEST_DATABASE_URL (CI service container / local docker compose); skipped
 * otherwise so `pnpm test` stays hermetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { PostgresConnectionParams } from '@evidata/connector-postgres';
import type { SchemaTable } from '@evidata/ports';
import { IntrospectionService } from './introspect';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const run = describe.skipIf(!ADMIN_URL);

run('IntrospectionService (real Postgres)', () => {
  let admin: Client;
  let params: PostgresConnectionParams;
  const svc = new IntrospectionService();

  beforeAll(async () => {
    const url = new URL(ADMIN_URL as string);
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS intro_test CASCADE');
    await admin.query('CREATE SCHEMA intro_test');
    await admin.query(
      'CREATE TABLE intro_test.customers (id integer PRIMARY KEY, email text NOT NULL)',
    );
    await admin.query("COMMENT ON TABLE intro_test.customers IS 'Accounts'");
    await admin.query("COMMENT ON COLUMN intro_test.customers.email IS 'contact email'");
    await admin.query(
      `CREATE TABLE intro_test.orders (
         id integer PRIMARY KEY,
         customer_id integer REFERENCES intro_test.customers(id),
         total numeric
       )`,
    );
    await admin.query('CREATE INDEX orders_customer_idx ON intro_test.orders(customer_id)');
    // Composite (2-column) FK to verify every column pair is captured.
    await admin.query(
      'CREATE TABLE intro_test.tenants (region text, tid integer, PRIMARY KEY (region, tid))',
    );
    await admin.query(
      `CREATE TABLE intro_test.usage_rows (
         id integer PRIMARY KEY, region text, tid integer,
         FOREIGN KEY (region, tid) REFERENCES intro_test.tenants(region, tid)
       )`,
    );
    await admin.query('ANALYZE intro_test.customers, intro_test.orders');

    params = {
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: false,
    };
  });

  afterAll(async () => {
    if (admin) {
      await admin.query('DROP SCHEMA IF EXISTS intro_test CASCADE').catch(() => {});
      await admin.end();
    }
  });

  const find = (tables: SchemaTable[], name: string): SchemaTable => {
    const t = tables.find((x) => x.name === name);
    if (!t) throw new Error(`table ${name} not captured`);
    return t;
  };

  it('captures tables, columns, types, nullability, comments, PK', async () => {
    const snap = await svc.capture(params, 'ds-test');
    expect(snap.dataSourceId).toBe('ds-test');
    expect(snap.partial).toBe(false);

    const customers = find(snap.tables, 'intro_test.customers');
    expect(customers.comment).toBe('Accounts');
    const id = customers.columns.find((c) => c.name === 'id');
    expect(id).toMatchObject({ dataType: 'integer', nullable: false, primaryKey: true });
    const email = customers.columns.find((c) => c.name === 'email');
    expect(email).toMatchObject({ dataType: 'text', nullable: false, comment: 'contact email' });
    expect(email?.primaryKey).toBeUndefined();
  });

  it('captures foreign keys, row estimates, and index names', async () => {
    const snap = await svc.capture(params, 'ds-test');
    const orders = find(snap.tables, 'intro_test.orders');
    const customerId = orders.columns.find((c) => c.name === 'customer_id');
    expect(customerId?.references).toEqual({ table: 'intro_test.customers', column: 'id' });
    expect(typeof orders.rowEstimate).toBe('number');
    expect(orders.indexes).toContain('orders_customer_idx');
  });

  it('records every column of a composite foreign key', async () => {
    const snap = await svc.capture(params, 'ds-test');
    const usage = find(snap.tables, 'intro_test.usage_rows');
    const region = usage.columns.find((c) => c.name === 'region');
    const tid = usage.columns.find((c) => c.name === 'tid');
    expect(region?.references).toEqual({ table: 'intro_test.tenants', column: 'region' });
    expect(tid?.references).toEqual({ table: 'intro_test.tenants', column: 'tid' });
  });

  it('excludes system schemas and flags large captures as partial', async () => {
    const snap = await svc.capture(params, 'ds-test');
    // No system-schema relations (they'd be qualified `pg_catalog.*` /
    // `information_schema.*`). A *user* table named e.g. `pg_exec_test` is fine.
    expect(snap.tables.some((t) => t.name.includes('pg_catalog'))).toBe(false);
    expect(snap.tables.some((t) => t.name.includes('information_schema'))).toBe(false);

    const capped = await svc.capture(params, 'ds-test', { maxTables: 1 });
    expect(capped.partial).toBe(true);
    expect(capped.tables).toHaveLength(1);
  });
});
