import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Answer } from '@evidata/answer-contract';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from './index';
import {
  answers,
  businessGlossaryTerms,
  dataSourceContexts,
  dataSourceConnections,
  dataSources,
  entityMappings,
  policies,
} from './schema';

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

  it('binds each Evidence row to a recorded QueryRun (provenance FK)', async () => {
    const bound = await handle.client.query<{ n: number }>(
      `select count(*)::int as n
       from evidata_meta.evidence e
       join evidata_meta.query_runs q on q.id = e.query_run_id
       where e.investigation_id = 'inv1' and e.evidence_ref = 'E1'`,
    );
    // one binding per saved version (v1 + v2)
    expect(bound.rows[0]?.n).toBe(2);
  });

  it('appends a rerun (no question) without adding a user turn', async () => {
    const before = await store.getInvestigation('inv1');
    const userTurnsBefore = before?.turns.filter((t) => t.role === 'user').length ?? 0;

    const v3 = await store.saveAnswer({
      investigationId: 'inv1',
      answer: mkAnswer(3),
      queryRuns: runs,
    });
    expect(v3.meta.version).toBe(3);

    const after = await store.getInvestigation('inv1');
    expect(after?.turns.filter((t) => t.role === 'user').length).toBe(userTurnsBefore);
    expect(after?.turns.some((t) => t.role === 'agent' && t.answerVersion === 3)).toBe(true);
  });

  it('lists investigations with the latest answer status', async () => {
    const item = (await store.listInvestigations()).find((i) => i.id === 'inv1');
    expect(item?.latestStatus).toBe('Answered');
  });

  it('returns null for an unknown investigation', async () => {
    expect(await store.getInvestigation('does-not-exist')).toBeNull();
  });
});

describe('DrizzleMetadataStore — identity (spec 08 §5)', () => {
  it('createFirstUser inserts the Owner once, then returns null (atomic first-run)', async () => {
    expect(await store.countUsers()).toBe(0);
    const first = await store.createFirstUser({
      id: 'u-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: 'scrypt$...',
    });
    expect(first?.id).toBe('u-1');
    expect(await store.countUsers()).toBe(1);

    // A second first-run attempt is rejected — no second account is created.
    const second = await store.createFirstUser({
      id: 'u-2',
      email: 'other@example.com',
      displayName: 'Other',
      passwordHash: 'x',
    });
    expect(second).toBeNull();
    expect(await store.countUsers()).toBe(1);

    expect((await store.getUserByEmail('owner@example.com'))?.id).toBe('u-1');
    expect(await store.getUserByEmail('nobody@example.com')).toBeNull();
  });

  it('resolves a live session to its user, and not an expired or deleted one', async () => {
    await store.createSession({
      id: 's-live',
      userId: 'u-1',
      tokenHash: 'live-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await store.createSession({
      id: 's-exp',
      userId: 'u-1',
      tokenHash: 'expired-hash',
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect((await store.getSessionUser('live-hash'))?.email).toBe('owner@example.com');
    expect(await store.getSessionUser('expired-hash')).toBeNull(); // past expiry
    expect(await store.getSessionUser('no-such-hash')).toBeNull();

    await store.deleteSession('live-hash');
    expect(await store.getSessionUser('live-hash')).toBeNull(); // revoked
  });
});

describe('DrizzleMetadataStore — connections (spec 08 §6)', () => {
  const blob = { v: 1, keyId: 'k1', iv: 'aaa', ciphertext: 'bbb', authTag: 'ccc' };

  it('creates a connection + membership; summary omits the blob, record keeps it', async () => {
    const rec = await store.createConnection({
      id: 'c-1',
      kind: 'postgres',
      name: 'Warehouse',
      host: 'db.internal',
      port: 5432,
      database: 'analytics',
      sslMode: 'require',
      credentialBlob: blob,
      health: 'Untested',
      createdBy: 'u-1',
    });
    expect(rec.credentialBlob).toEqual(blob);

    await store.createConnectionMembership({
      id: 'm-1',
      userId: 'u-1',
      connectionId: 'c-1',
      role: 'owner',
    });
    expect(await store.getConnectionRole('u-1', 'c-1')).toBe('owner');
    expect(await store.getConnectionRole('ghost', 'c-1')).toBeNull();

    const summary = (await store.listConnections('u-1')).find((c) => c.id === 'c-1');
    expect(summary?.name).toBe('Warehouse');
    expect((summary as Record<string, unknown> | undefined)?.credentialBlob).toBeUndefined();
    expect((await store.getConnection('c-1'))?.credentialBlob).toEqual(blob);
    // A non-member sees nothing (existence-hiding).
    expect(await store.listConnections('ghost')).toEqual([]);
  });

  it('stores snapshots + data sources, updates health, and cleans up on delete', async () => {
    await store.createDataSource({
      id: 'ds-c1',
      name: 'Warehouse',
      kind: 'postgres',
      connectionId: 'c-1',
    });
    expect(await store.listDataSourcesByConnection('c-1')).toEqual([
      { id: 'ds-c1', name: 'Warehouse' },
    ]);

    await store.saveSchemaSnapshot({
      id: 'snap-1',
      connectionId: 'c-1',
      status: 'complete',
      partial: false,
      payload: {
        dataSourceId: 'c-1',
        capturedAt: '2026-06-19T00:00:00.000Z',
        partial: false,
        tables: [{ name: 't', columns: [] }],
      },
      capturedAt: new Date(),
    });
    expect((await store.getLatestSnapshot('c-1'))?.tables[0]?.name).toBe('t');

    await store.setConnectionHealth('c-1', 'Healthy');
    expect((await store.getConnection('c-1'))?.health).toBe('Healthy');

    await store.deleteConnection('c-1');
    expect(await store.getConnection('c-1')).toBeNull();
    expect(await store.getLatestSnapshot('c-1')).toBeNull();
    expect(await store.listDataSourcesByConnection('c-1')).toEqual([]);
  });

  it('deleteConnection cascades M2 child rows (no FK block)', async () => {
    await store.createConnection({
      id: 'c-2',
      kind: 'postgres',
      name: 'WithM2',
      host: 'h',
      port: 5432,
      database: 'd',
      sslMode: 'require',
      credentialBlob: blob,
      health: 'Untested',
      createdBy: 'u-1', // created by the identity test's first user
    });
    await store.createDataSource({
      id: 'ds-2',
      name: 'WithM2',
      kind: 'postgres',
      connectionId: 'c-2',
    });
    const now = new Date();
    await handle.db.insert(dataSourceConnections).values({
      id: 'dsc-2',
      dataSourceId: 'ds-2',
      connectionId: 'c-2',
      alias: null,
      includedTables: [],
      fieldRules: {},
      createdAt: now,
    });
    await handle.db.insert(policies).values({
      id: 'pol-2',
      dataSourceId: 'ds-2',
      rowLimit: 1000,
      timeoutMs: 5000,
      statementTimeoutMs: null,
      confirmOnBroadScan: false,
      confirmOnSensitiveAccess: false,
      updatedAt: now,
    });
    await handle.db.insert(dataSourceContexts).values({
      id: 'ctx-2',
      dataSourceId: 'ds-2',
      overview: '',
      payload: {},
      updatedAt: now,
    });

    // Despite the data_source_connections FK + M2 children, delete must succeed.
    await store.deleteConnection('c-2');
    expect(await store.getConnection('c-2')).toBeNull();
    expect(
      (await handle.db.select().from(policies).where(eq(policies.dataSourceId, 'ds-2'))).length,
    ).toBe(0);
  });
});

describe('DrizzleMetadataStore — M2 authoring reads (spec 09 §2/§5)', () => {
  const blob = { v: 1, keyId: 'k1', iv: 'aaa', ciphertext: 'bbb', authTag: 'ccc' };
  const at = new Date('2026-06-18T00:00:00.000Z');

  beforeAll(async () => {
    // A connection (FK target for the binding), created by the identity test's user.
    await store.createConnection({
      id: 'c-pub',
      kind: 'postgres',
      name: 'Real PG',
      host: 'h',
      port: 5432,
      database: 'd',
      sslMode: 'require',
      credentialBlob: blob,
      health: 'Healthy',
      createdBy: 'u-1',
    });
    // One published source + one draft (the draft must NOT appear in listPublished).
    await handle.db.insert(dataSources).values([
      {
        id: 'ds-pub',
        name: 'Published Source',
        kind: 'postgres',
        connectionId: 'c-pub',
        description: 'A real one',
        lifecycle: 'published',
        createdAt: at,
      },
      {
        id: 'ds-draft',
        name: 'Draft Source',
        kind: 'postgres',
        connectionId: 'c-pub',
        lifecycle: 'draft',
        createdAt: at,
      },
    ]);
    await handle.db.insert(dataSourceConnections).values({
      id: 'dsc-pub',
      dataSourceId: 'ds-pub',
      connectionId: 'c-pub',
      alias: 'main',
      includedTables: ['accounts', 'invoices'],
      fieldRules: { sensitiveColumns: ['accounts.email'] },
      createdAt: at,
    });
    await handle.db.insert(policies).values({
      id: 'pol-pub',
      dataSourceId: 'ds-pub',
      rowLimit: 500,
      timeoutMs: 8000,
      statementTimeoutMs: 7000,
      confirmOnBroadScan: true,
      confirmOnSensitiveAccess: false,
      updatedAt: at,
    });
    await handle.db.insert(dataSourceContexts).values({
      id: 'ctx-pub',
      dataSourceId: 'ds-pub',
      overview: 'Billing data.',
      payload: { entities: [] },
      updatedAt: at,
    });
    await handle.db.insert(businessGlossaryTerms).values([
      {
        id: 'g1',
        dataSourceId: 'ds-pub',
        term: 'MRR',
        definition: 'monthly recurring revenue',
        status: 'verified',
        provenance: 'admin',
        createdAt: at,
      },
      {
        id: 'g2',
        dataSourceId: 'ds-pub',
        term: 'churn',
        definition: 'lost accounts',
        status: 'suggested',
        provenance: 'ai_draft',
        createdAt: at,
      },
    ]);
    await handle.db.insert(entityMappings).values([
      {
        id: 'm1',
        dataSourceId: 'ds-pub',
        fromRef: 'acct',
        toRef: 'accounts',
        status: 'verified',
        provenance: 'admin',
        createdAt: at,
      },
      {
        id: 'm2',
        dataSourceId: 'ds-pub',
        fromRef: 'inv',
        toRef: 'invoices',
        status: 'suggested',
        provenance: 'ai_draft',
        createdAt: at,
      },
    ]);
  });

  it('getDataSource returns the row with lifecycle; null when unknown', async () => {
    const ds = await store.getDataSource('ds-pub');
    expect(ds).toMatchObject({
      id: 'ds-pub',
      name: 'Published Source',
      kind: 'postgres',
      connectionId: 'c-pub',
      description: 'A real one',
      lifecycle: 'published',
    });
    expect(await store.getDataSource('nope')).toBeNull();
  });

  it('listPublishedDataSources returns only published sources', async () => {
    const list = await store.listPublishedDataSources();
    const ids = list.map((d) => d.id);
    expect(ids).toContain('ds-pub');
    expect(ids).not.toContain('ds-draft'); // a draft must never be runnable
  });

  it('getDataSourceConnection returns scope + field rules', async () => {
    const binding = await store.getDataSourceConnection('ds-pub');
    expect(binding).toMatchObject({
      connectionId: 'c-pub',
      alias: 'main',
      includedTables: ['accounts', 'invoices'],
      fieldRules: { sensitiveColumns: ['accounts.email'] },
    });
    expect(await store.getDataSourceConnection('ds-draft')).toBeNull();
  });

  it('getPolicy + getDataSourceContext read the authored governance', async () => {
    expect(await store.getPolicy('ds-pub')).toMatchObject({
      rowLimit: 500,
      timeoutMs: 8000,
      statementTimeoutMs: 7000,
      confirmOnBroadScan: true,
      confirmOnSensitiveAccess: false,
    });
    expect((await store.getDataSourceContext('ds-pub'))?.overview).toBe('Billing data.');
    expect(await store.getPolicy('nope')).toBeNull();
  });

  it('glossary + mappings filter by status (verified-only for the model)', async () => {
    const verifiedTerms = await store.getGlossaryTerms('ds-pub', 'verified');
    expect(verifiedTerms.map((t) => t.term)).toEqual(['MRR']);
    expect((await store.getGlossaryTerms('ds-pub')).length).toBe(2); // unfiltered

    const verifiedMaps = await store.getEntityMappings('ds-pub', 'verified');
    expect(verifiedMaps.map((m) => m.toRef)).toEqual(['accounts']);
    expect((await store.getEntityMappings('ds-pub')).length).toBe(2);
  });
});
