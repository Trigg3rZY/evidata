import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createMetadataDb, type MetadataDbHandle } from './client';
import { answers, evidence, investigations, queryRuns } from './schema';

let handle: MetadataDbHandle;

beforeAll(async () => {
  handle = await createMetadataDb(); // in-memory, migrations applied
});

afterAll(async () => {
  await handle.close();
});

const at = (iso: string): Date => new Date(iso);

describe('M0 metadata schema (spec 10)', () => {
  it('migrates the six tables into the evidata_meta schema', async () => {
    const res = await handle.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'evidata_meta' order by table_name`,
    );
    expect(res.rows.map((r) => r.table_name)).toEqual([
      'answers',
      'evidence',
      'investigations',
      'query_runs',
      'suggestions',
      'turns',
    ]);
  });

  it('round-trips an investigation and a JSONB answer payload', async () => {
    const { db } = handle;
    await db.insert(investigations).values({
      id: 'inv1',
      dataSourceId: 'sample',
      title: 'Why is ACME up?',
      createdAt: at('2026-06-01T00:00:00Z'),
      updatedAt: at('2026-06-01T00:00:00Z'),
    });

    const payload = { status: 'Answered', directAnswer: { en: 'Spend rose 38%' } };
    await db.insert(answers).values({
      id: 'ans1',
      investigationId: 'inv1',
      version: 1,
      status: 'Answered',
      confidence: 'Medium',
      isLatest: true,
      payload,
      createdAt: at('2026-06-01T00:00:01Z'),
    });

    const [row] = await db.select().from(answers).where(eq(answers.id, 'ans1'));
    expect(row?.payload).toEqual(payload);
    expect(row?.createdAfterKind).toBeNull(); // optional column defaults to null
  });

  it('enforces append-only versioning: one is_latest head per investigation', async () => {
    const { db } = handle;
    // Append v2: demote the prior head, insert the new head (spec 10 §6).
    await db
      .update(answers)
      .set({ isLatest: false })
      .where(and(eq(answers.investigationId, 'inv1'), eq(answers.isLatest, true)));
    await db.insert(answers).values({
      id: 'ans2',
      investigationId: 'inv1',
      version: 2,
      status: 'Answered',
      confidence: 'High',
      isLatest: true,
      createdAfterKind: 'followup',
      createdAfterFromVersion: 1,
      payload: { status: 'Answered' },
      createdAt: at('2026-06-01T00:00:02Z'),
    });

    const heads = await db
      .select()
      .from(answers)
      .where(and(eq(answers.investigationId, 'inv1'), eq(answers.isLatest, true)));
    expect(heads).toHaveLength(1);
    expect(heads[0]?.version).toBe(2);
  });

  it('rejects a duplicate (investigation, version) via the unique index', async () => {
    const { db } = handle;
    await expect(
      db.insert(answers).values({
        id: 'ans-dup',
        investigationId: 'inv1',
        version: 2, // collides with ans2
        status: 'Answered',
        confidence: 'High',
        isLatest: false,
        payload: {},
        createdAt: at('2026-06-01T00:00:03Z'),
      }),
    ).rejects.toThrow();
  });

  it('records a QueryRun and an Evidence row bound to it (G4 provenance)', async () => {
    const { db } = handle;
    await db.insert(queryRuns).values({
      id: 'qr1',
      investigationId: 'inv1',
      answerVersion: 1,
      connectorId: 'sample',
      sql: 'select sum(amount) from campaign_spend where account_id = 1',
      status: 'ok',
      rowCount: 1,
      truncated: false,
      elapsedMs: 7,
      startedAt: at('2026-06-01T00:00:01Z'),
    });
    await db.insert(evidence).values({
      id: 'ev1',
      investigationId: 'inv1',
      answerVersion: 1,
      evidenceRef: 'E1',
      queryRunId: 'qr1',
      purpose: 'May vs June spend for ACME',
      connectorId: 'sample',
      tables: ['campaign_spend'],
      sql: 'select sum(amount) from campaign_spend where account_id = 1',
      resultSummary: 'June 48200 vs May 34900 (+38.1%)',
      sampleRows: null,
      safety: 'auto_executed',
      policyNotes: 'Read-only · row limit 1000 · auto-executed (low risk)',
      redactedColumns: [],
      createdAt: at('2026-06-01T00:00:01Z'),
    });

    const [ev] = await db.select().from(evidence).where(eq(evidence.id, 'ev1'));
    expect(ev?.queryRunId).toBe('qr1');
    expect(ev?.tables).toEqual(['campaign_spend']);

    // evidence_ref is unique per (investigation, version).
    await expect(
      db.insert(evidence).values({
        id: 'ev-dup',
        investigationId: 'inv1',
        answerVersion: 1,
        evidenceRef: 'E1', // collides
        queryRunId: 'qr1',
        purpose: 'dup',
        connectorId: 'sample',
        tables: [],
        sql: 'select 1',
        resultSummary: 'x',
        sampleRows: null,
        safety: 'auto_executed',
        policyNotes: '',
        redactedColumns: [],
        createdAt: at('2026-06-01T00:00:04Z'),
      }),
    ).rejects.toThrow();
  });

  it('enforces the investigation foreign key', async () => {
    const { db } = handle;
    await expect(
      db.insert(answers).values({
        id: 'ans-orphan',
        investigationId: 'does-not-exist',
        version: 1,
        status: 'Answered',
        confidence: 'High',
        isLatest: true,
        payload: {},
        createdAt: at('2026-06-01T00:00:05Z'),
      }),
    ).rejects.toThrow();
  });
});
