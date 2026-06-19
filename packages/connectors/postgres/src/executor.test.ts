/**
 * Integration tests for PostgresExecutor against a REAL Postgres (spec 08 §11).
 * Gated on TEST_DATABASE_URL — CI sets it to the `postgres` service container;
 * locally, `docker compose up -d postgres` then export it. Skipped otherwise so
 * `pnpm test` stays hermetic without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgresExecutor } from './executor';
import type { PostgresConnectionParams } from './types';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const RO_USER = 'evidata_ro_test';
const RO_PW = 'ro_pw';

const run = describe.skipIf(!ADMIN_URL);

run('PostgresExecutor (real Postgres)', () => {
  let admin: Client;
  let executor: PostgresExecutor;
  let roParams: PostgresConnectionParams;

  beforeAll(async () => {
    const url = new URL(ADMIN_URL as string);
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();

    // A read-only-ish role that nonetheless HOLDS write privileges on the table,
    // so a blocked write proves the READ ONLY transaction (not just the grant).
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RO_USER}') THEN
        CREATE ROLE ${RO_USER} LOGIN PASSWORD '${RO_PW}';
      END IF;
    END $$;`);
    await admin.query('DROP TABLE IF EXISTS pg_exec_test');
    await admin.query('CREATE TABLE pg_exec_test (id integer PRIMARY KEY, label text)');
    await admin.query(
      `INSERT INTO pg_exec_test (id, label) SELECT g, 'row-' || g FROM generate_series(1, 5) g`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${RO_USER}`);
    await admin.query(`GRANT SELECT, INSERT ON pg_exec_test TO ${RO_USER}`);

    roParams = {
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      user: RO_USER,
      password: RO_PW,
      ssl: false,
    };
    executor = new PostgresExecutor(roParams);
  });

  afterAll(async () => {
    await executor?.close();
    if (admin) {
      await admin.query('DROP TABLE IF EXISTS pg_exec_test').catch(() => {});
      await admin.end();
    }
  });

  const opts = { rowLimit: 1000, timeoutMs: 5000 };

  it('runs a SELECT and returns typed columns + rows', async () => {
    const res = await executor.run('SELECT id, label FROM pg_exec_test ORDER BY id', opts);
    expect(res.rowCount).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.columns).toEqual([
      { name: 'id', dataType: 'integer' },
      { name: 'label', dataType: 'text' },
    ]);
    expect(res.rows[0]).toEqual({ id: 1, label: 'row-1' });
  });

  it('bounds rows at rowLimit and flags truncation (cursor reads rowLimit+1)', async () => {
    const res = await executor.run('SELECT id FROM pg_exec_test ORDER BY id', {
      rowLimit: 2,
      timeoutMs: 5000,
    });
    expect(res.rowCount).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it('rejects a write via the READ ONLY transaction (defense in depth)', async () => {
    // The role HAS INSERT privilege — only the READ ONLY tx blocks it.
    await expect(
      executor.run("INSERT INTO pg_exec_test (id, label) VALUES (99, 'x')", opts),
    ).rejects.toThrow(/read-only/i);
  });

  it('enforces the statement timeout', async () => {
    await expect(
      executor.run('SELECT pg_sleep(3)', { rowLimit: 1, timeoutMs: 250 }),
    ).rejects.toThrow(/time limit/i);
  });

  it('cancels an in-flight statement on abort (returns fast, AbortError)', async () => {
    const ctrl = new AbortController();
    const started = performance.now();
    setTimeout(() => ctrl.abort(), 200);
    let name = '';
    try {
      await executor.run('SELECT pg_sleep(10)', {
        rowLimit: 1,
        timeoutMs: 30_000,
        signal: ctrl.signal,
      });
    } catch (e) {
      name = (e as Error).name;
    }
    expect(name).toBe('AbortError');
    expect(performance.now() - started).toBeLessThan(5000); // cancelled, not waited out
  });

  it('maps an unknown table to a passthrough SQL error (no host/DSN leak)', async () => {
    await expect(executor.run('SELECT * FROM no_such_table_xyz', opts)).rejects.toThrow(
      /no_such_table_xyz|does not exist/i,
    );
  });

  it('maps a connect-time auth failure without leaking host/credentials', async () => {
    const bad = new PostgresExecutor({ ...roParams, password: 'definitely-wrong' });
    try {
      const err = await bad.run('SELECT 1', opts).then(
        () => null,
        (e: Error) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toMatch(/authentication/i);
      // The mapped message must not echo host/port/role from the raw driver error.
      expect(err?.message).not.toContain(roParams.host);
      expect(err?.message).not.toContain(RO_USER);
    } finally {
      await bad.close();
    }
  });
});
