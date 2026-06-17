import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSafetyGate } from '@evidata/safety';
import type { QueryExecutor } from '@evidata/ports';
import type { PGlite } from '@electric-sql/pglite';
import {
  ACME_JUNE_SPEND,
  ACME_MAY_SPEND,
  ACME_MOM_PCT,
  ACME_SUMMER_SALE_JUNE,
  createSampleConnector,
  SAMPLE_SCHEMA_SNAPSHOT,
  sampleSafetyContext,
  SEED_COUNTS,
  type SampleConnectorHandle,
} from './index';

let handle: SampleConnectorHandle;
let executor: QueryExecutor;
let client: PGlite;
const exec = { rowLimit: 1000, timeoutMs: 5000 };

beforeAll(async () => {
  handle = await createSampleConnector();
  executor = handle.connector.getExecutor();
  client = handle.client;
});

afterAll(async () => {
  await handle.close();
});

const num = (v: unknown): number => Number(v);

describe('Sample seed (spec 05 §2.2)', () => {
  it('seeds the deterministic row counts', async () => {
    for (const [table, expected] of Object.entries(SEED_COUNTS)) {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(r.rows[0]?.n, table).toBe(expected);
    }
  });

  it("reproduces ACME's posted spend: May 34900, June 48200 (+38.1%)", async () => {
    const monthSpend = async (from: string, to: string): Promise<number> => {
      const r = await executor.run(
        `select sum(amount) as total from campaign_spend
         where account_id = 1 and status = 'posted' and day >= '${from}' and day < '${to}'`,
        exec,
      );
      return num(r.rows[0]?.total);
    };
    const may = await monthSpend('2026-05-01', '2026-06-01');
    const june = await monthSpend('2026-06-01', '2026-07-01');
    expect(may).toBe(ACME_MAY_SPEND);
    expect(june).toBe(ACME_JUNE_SPEND);
    expect(Math.round(((june - may) / may) * 1000) / 10).toBe(ACME_MOM_PCT);
  });

  it("excludes 'void' rows from spend", async () => {
    const posted = await client.query<{ total: string }>(
      `select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted' and day >= '2026-06-01'`,
    );
    const all = await client.query<{ total: string }>(
      `select sum(amount) as total from campaign_spend where account_id = 1 and day >= '2026-06-01'`,
    );
    expect(num(all.rows[0]?.total)).toBeGreaterThan(num(posted.rows[0]?.total));
    expect(num(posted.rows[0]?.total)).toBe(ACME_JUNE_SPEND);
  });

  it('attributes the June increase to the Summer Sale campaign', async () => {
    const r = await executor.run(
      `select campaign_id, sum(amount) as total from campaign_spend
       where account_id = 1 and status = 'posted' and day >= '2026-06-01' and day < '2026-07-01'
       group by campaign_id order by total desc`,
      exec,
    );
    const summerSale = r.rows.find((row) => num(row.campaign_id) === 10);
    expect(num(summerSale?.total)).toBe(ACME_SUMMER_SALE_JUNE);
    expect(ACME_JUNE_SPEND - ACME_MAY_SPEND).toBe(ACME_SUMMER_SALE_JUNE);
  });

  it('ranks customers by spend (top-customers scenario), excluding the churned account', async () => {
    const r = await executor.run(
      `select a.id, sum(s.amount) as total from accounts a
       join campaign_spend s on s.account_id = a.id
       where s.status = 'posted'
       group by a.id order by total desc limit 5`,
      exec,
    );
    expect(r.rows.map((row) => num(row.id))).toEqual([1, 5, 2, 4, 3]);
    expect(r.rows.map((row) => num(row.id))).not.toContain(6); // Stark, churned, no spend
  });
});

describe('PgliteQueryExecutor (spec 01 §2.1)', () => {
  it('caps rows to rowLimit and flags truncation', async () => {
    const res = await executor.run('select * from campaign_spend order by id', {
      rowLimit: 5,
      timeoutMs: 5000,
    });
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('reports column metadata with mapped type names', async () => {
    const res = await executor.run(
      'select id, name, contact_email from accounts where id = 1',
      exec,
    );
    expect(res.columns.map((c) => c.name)).toEqual(['id', 'name', 'contact_email']);
    expect(res.columns[0]?.dataType).toBe('integer');
    expect(res.columns[1]?.dataType).toBe('text');
  });
});

describe('Schema snapshot (spec 01 §2.1)', () => {
  it('exposes the four business tables with keys and FKs', async () => {
    const snap = await handle.connector.getSchemaSnapshot();
    expect(snap).toBe(SAMPLE_SCHEMA_SNAPSHOT);
    expect(snap.tables.map((t) => t.name)).toEqual([
      'accounts',
      'campaigns',
      'campaign_spend',
      'invoices',
    ]);
    const accounts = snap.tables.find((t) => t.name === 'accounts');
    expect(accounts?.columns.some((c) => c.name === 'contact_email')).toBe(true);
    const spend = snap.tables.find((t) => t.name === 'campaign_spend');
    expect(spend?.columns.find((c) => c.name === 'campaign_id')?.references).toEqual({
      table: 'campaigns',
      column: 'id',
    });
  });
});

describe('SafetyGate ↔ executor on the real Sample (the trust boundary)', () => {
  const gate = createSafetyGate();

  it('allows an authorized read-only query, which then executes', async () => {
    const sql =
      "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'";
    const decision = gate.check(sql, sampleSafetyContext());
    expect(decision.verdict).toBe('allow');
    const res = await executor.run(sql, exec);
    expect(num(res.rows[0]?.total)).toBe(ACME_MAY_SPEND + ACME_JUNE_SPEND);
  });

  it('rejects a mutation before any execution (read-only guarantee)', () => {
    const decision = gate.check(
      "update accounts set name = 'x' where id = 1",
      sampleSafetyContext(),
    );
    expect(decision.verdict).toBe('reject');
    if (decision.verdict === 'reject') expect(decision.reason).toBe('not_read_only');
  });

  it('rejects an unauthorized table', () => {
    const decision = gate.check('select * from pg_authid', sampleSafetyContext());
    expect(decision.verdict).toBe('reject');
    if (decision.verdict === 'reject') expect(decision.reason).toBe('unauthorized_table');
  });

  it('flags a sensitive column and requires confirmation', () => {
    const decision = gate.check(
      'select contact_email from accounts where id = 1',
      sampleSafetyContext(),
    );
    expect(decision.verdict).toBe('allow');
    if (decision.verdict === 'allow') {
      expect(decision.touchedSensitive).toContain('accounts.contact_email');
      expect(decision.needsConfirmation).toBe(true);
    }
  });
});
