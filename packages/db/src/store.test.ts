import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Answer } from '@evidata/answer-contract';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from './index';
import { answers } from './schema';

let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
});
afterAll(async () => {
  await handle.close();
});

function mkAnswer(version: number): Answer {
  return {
    investigationId: 'inv1',
    status: 'Answered',
    directAnswer: 'Spend rose 38%.',
    confidence: 'High',
    confidenceReason: 'single source of truth',
    keyFindings: [{ text: 'up 38%', evidenceIds: ['E1'] }],
    evidence: [
      {
        id: 'E1',
        purpose: 'compare months',
        dataSourceId: 'sample',
        dataSourceName: 'Sample',
        connectorId: 'sample',
        tables: ['campaign_spend'],
        sql: 'select 1',
        resultSummary: '1 row',
        execution: { status: 'ok', elapsedMs: 2, rowCount: 1, truncated: false },
        safety: 'auto_executed',
        policyNotes: 'read-only',
        redactedColumns: [],
      },
    ],
    assumptions: [],
    caveats: [],
    recommendedFollowups: [],
    meta: { version, createdAt: '2026-06-17T00:00:00Z', isLatest: true },
  };
}

const runs = [
  {
    id: 'qr',
    connectorId: 'sample',
    sql: 'select 1',
    status: 'ok' as const,
    rowCount: 1,
    truncated: false,
    elapsedMs: 2,
    evidenceRef: 'E1',
  },
];

const count = async (table: string): Promise<number> => {
  const r = await handle.client.query<{ n: number }>(
    `select count(*)::int as n from evidata_meta.${table}`,
  );
  return r.rows[0]?.n ?? -1;
};

describe('DrizzleMetadataStore (spec 10)', () => {
  it('persists an investigation, its answer, turns, and provenance', async () => {
    await store.createInvestigation({ id: 'inv1', dataSourceId: 'sample', title: 'why up' });
    const saved = await store.saveAnswer({
      investigationId: 'inv1',
      question: 'why up?',
      answer: mkAnswer(1),
      queryRuns: runs,
    });
    expect(saved.meta.version).toBe(1);

    const thread = await store.getInvestigation('inv1');
    expect(thread?.answers).toHaveLength(1);
    expect(thread?.answers[0]?.evidence[0]?.id).toBe('E1');
    expect(thread?.turns.filter((t) => t.role === 'user').map((t) => t.question)).toEqual([
      'why up?',
    ]);
    expect(thread?.turns.some((t) => t.role === 'agent' && t.answerVersion === 1)).toBe(true);

    expect(await count('query_runs')).toBe(1);
    expect(await count('evidence')).toBe(1);
  });

  it('appends a second version, keeping exactly one latest head', async () => {
    const v2 = await store.saveAnswer({
      investigationId: 'inv1',
      question: 'and by week?',
      answer: mkAnswer(2),
      queryRuns: runs,
    });
    expect(v2.meta.version).toBe(2);

    const heads = await handle.db
      .select()
      .from(answers)
      .where(and(eq(answers.investigationId, 'inv1'), eq(answers.isLatest, true)));
    expect(heads).toHaveLength(1);
    expect(heads[0]?.version).toBe(2);

    const thread = await store.getInvestigation('inv1');
    expect(thread?.answers.map((a) => a.meta.version)).toEqual([1, 2]);
  });

  it('lists investigations with the latest answer status', async () => {
    const item = (await store.listInvestigations()).find((i) => i.id === 'inv1');
    expect(item?.latestStatus).toBe('Answered');
  });

  it('returns null for an unknown investigation', async () => {
    expect(await store.getInvestigation('does-not-exist')).toBeNull();
  });
});
