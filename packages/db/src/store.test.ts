import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { MIGRATIONS } from './schema-sql';
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

  it('records an immutable model snapshot for audit, or null when omitted (#116)', async () => {
    const snap = {
      source: 'registered' as const,
      model: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    };
    await store.createInvestigation({
      id: 'inv-snap',
      dataSourceId: 'sample',
      title: 'snap',
      modelSnapshot: snap,
    });
    const r = await handle.client.query<{ model_snapshot: unknown }>(
      "select model_snapshot from evidata_meta.investigations where id = 'inv-snap'",
    );
    expect(r.rows[0]?.model_snapshot).toEqual(snap);

    await store.createInvestigation({ id: 'inv-nosnap', dataSourceId: 'sample', title: 'x' });
    const r2 = await handle.client.query<{ model_snapshot: unknown }>(
      "select model_snapshot from evidata_meta.investigations where id = 'inv-nosnap'",
    );
    expect(r2.rows[0]?.model_snapshot).toBeNull();
  });

  it('binds + reads the model provider per investigation (epic #113)', async () => {
    await store.createInvestigation({
      id: 'inv-mp',
      dataSourceId: 'sample',
      title: 'bound',
      modelProviderId: 'mp_abc',
    });
    expect((await store.getInvestigation('inv-mp'))?.modelProviderId).toBe('mp_abc');
    expect(await store.getInvestigationModelProviderId('inv-mp')).toBe('mp_abc');

    // No model bound (default) → null; unknown investigation → null.
    await store.createInvestigation({ id: 'inv-def', dataSourceId: 'sample', title: 'default' });
    expect((await store.getInvestigation('inv-def'))?.modelProviderId).toBeNull();
    expect(await store.getInvestigationModelProviderId('inv-def')).toBeNull();
    expect(await store.getInvestigationModelProviderId('does-not-exist')).toBeNull();
  });
});

describe('DrizzleMetadataStore — investigation owner isolation (#177)', () => {
  it("a user lists/gets only their own; another user's thread is hidden (IDOR)", async () => {
    await store.createInvestigation({
      id: 'inv-alice',
      dataSourceId: 'sample',
      title: 'alice thread',
      ownerId: 'user-alice',
    });
    await store.createInvestigation({
      id: 'inv-bob',
      dataSourceId: 'sample',
      title: 'bob thread',
      ownerId: 'user-bob',
    });

    const aliceList = (await store.listInvestigations({ userId: 'user-alice' })).map((i) => i.id);
    const bobList = (await store.listInvestigations({ userId: 'user-bob' })).map((i) => i.id);
    expect(aliceList).toContain('inv-alice');
    expect(aliceList).not.toContain('inv-bob');
    expect(bobList).toContain('inv-bob');
    expect(bobList).not.toContain('inv-alice');

    // IDOR: fetching another user's thread by id returns null (→ 404), no existence leak.
    expect(await store.getInvestigation('inv-alice', 'user-alice')).not.toBeNull();
    expect(await store.getInvestigation('inv-alice', 'user-bob')).toBeNull();
    expect(await store.getInvestigation('inv-bob', 'user-alice')).toBeNull();
  });

  it('anonymous lists only ownerId-null threads; owned threads are hidden', async () => {
    // No userId → anonymous scope (ownerId IS NULL): inv-alice/inv-bob are owned → hidden.
    const anonList = (await store.listInvestigations({})).map((i) => i.id);
    expect(anonList).not.toContain('inv-alice');
    expect(anonList).not.toContain('inv-bob');
    // Anonymous get of an owned thread → null.
    expect(await store.getInvestigation('inv-alice')).toBeNull();
  });
});

describe('DrizzleMetadataStore — identity (spec 08 §5)', () => {
  it('createFirstUser inserts the Owner once, then returns null (atomic first-run)', async () => {
    expect(await store.countUsers()).toBe(0);
    const first = await store.createFirstUser({
      id: 'u-1',
      username: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: 'scrypt$...',
    });
    expect(first?.id).toBe('u-1');
    expect(await store.countUsers()).toBe(1);

    // A second first-run attempt is rejected — no second account is created.
    const second = await store.createFirstUser({
      id: 'u-2',
      username: 'other@example.com',
      displayName: 'Other',
      passwordHash: 'x',
    });
    expect(second).toBeNull();
    expect(await store.countUsers()).toBe(1);

    expect((await store.getUserByUsername('owner@example.com'))?.id).toBe('u-1');
    expect(await store.getUserByUsername('nobody@example.com')).toBeNull();
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

    expect((await store.getSessionUser('live-hash'))?.username).toBe('owner@example.com');
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
    // A membership + a pending invite (B1a/B1b) — both reference ds-2 (must cascade).
    await store.createDataSourceMembership({
      id: 'dm-2',
      userId: 'u-1',
      dataSourceId: 'ds-2',
      role: 'owner',
    });
    await store.createDataSourceInvite({
      id: 'inv-2',
      dataSourceId: 'ds-2',
      role: 'querier',
      tokenHash: 'h-2',
      createdBy: 'u-1',
      expiresAt: now,
    });

    // Despite the data_source_connections FK + M2 children (incl. invites), delete succeeds.
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

describe('DrizzleMetadataStore — model providers (epic #106)', () => {
  const blob = { v: 1, keyId: 'k1', iv: 'aaa', ciphertext: 'bbb', authTag: 'ccc' };

  it('creates a provider; summary omits the blob, record keeps it; delete removes it', async () => {
    const rec = await store.createModelProvider({
      id: 'mp-1',
      name: 'Team DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      params: { temperature: 0, effort: 'low' },
      capabilities: { toolChoice: 'required' },
      credentialBlob: blob,
      createdBy: 'u-1', // created by the identity test's first user
    });
    expect(rec.credentialBlob).toEqual(blob);
    expect(rec.createdAt).toBeTruthy();

    const summary = (await store.listModelProviders()).find((p) => p.id === 'mp-1');
    expect(summary?.model).toBe('deepseek-chat');
    expect(summary?.params).toEqual({ temperature: 0, effort: 'low' });
    expect(summary?.capabilities).toEqual({ toolChoice: 'required' });
    expect((summary as Record<string, unknown> | undefined)?.credentialBlob).toBeUndefined();

    // The full record (internal) keeps the encrypted blob.
    expect((await store.getModelProvider('mp-1'))?.credentialBlob).toEqual(blob);
    expect(await store.getModelProvider('nope')).toBeNull();

    await store.deleteModelProvider('mp-1');
    expect(await store.getModelProvider('mp-1')).toBeNull();
    expect((await store.listModelProviders()).some((p) => p.id === 'mp-1')).toBe(false);
  });
});

describe('0006 backfill — Data Source owner memberships (M2-B1a)', () => {
  const blob = { v: 1, keyId: 'k1', iv: 'aaa', ciphertext: 'bbb', authTag: 'ccc' };
  const BACKFILL = MIGRATIONS.find((m) => m.name.includes('backfill_ds_owner'))!.sql;

  it('grants connection owners a DS owner role for pre-B1a sources, idempotently', async () => {
    const h = await createMetadataDb();
    const s = new DrizzleMetadataStore(h.db);
    const owner = await s.createFirstUser({
      id: 'o',
      username: 'o',
      displayName: 'O',
      passwordHash: 'x',
    });
    await s.createConnection({
      id: 'c',
      kind: 'postgres',
      name: 'n',
      host: 'h',
      port: 5432,
      database: 'd',
      sslMode: 'disable',
      credentialBlob: blob,
      health: 'Healthy',
      createdBy: owner!.id,
    });
    await s.createConnectionMembership({ id: 'm', userId: 'o', connectionId: 'c', role: 'owner' });
    // A source created the M1 way (no membership row) — the pre-B1a state.
    await s.createDataSource({ id: 'ds', name: 'ds', kind: 'postgres', connectionId: 'c' });
    expect(await s.getDataSourceRole('o', 'ds')).toBeNull();

    await h.db.execute(sql.raw(BACKFILL));
    expect(await s.getDataSourceRole('o', 'ds')).toBe('owner');

    // Re-running is a no-op (deterministic id + NOT EXISTS) — no dup, no error.
    await h.db.execute(sql.raw(BACKFILL));
    expect(
      (await s.listDataSourceMemberships('o')).filter((x) => x.dataSourceId === 'ds'),
    ).toHaveLength(1);
    await h.close();
  });
});

describe('DrizzleMetadataStore — correction-loop suggestions (M2-B4, #123)', () => {
  it('records, lists (by status, with submitter name), gets, and resolves a suggestion', async () => {
    await store.createUser({
      id: 'sg-user',
      username: 'quinn-sg',
      displayName: 'Quinn SG',
      passwordHash: 'x',
    });
    await store.createInvestigation({ id: 'sg-inv', dataSourceId: 'sample', title: 'why blocked' });
    await store.createSuggestion({
      id: 'sg-1',
      investigationId: 'sg-inv',
      dataSourceId: 'sample',
      answerVersion: 1,
      kind: 'notify_admin_verify',
      targetRef: 'invoices.customer_ref→accounts.id',
      description: 'The mapping is only Suggested.',
      proposedDefinition: null,
      submittedBy: 'sg-user',
    });

    // Listed in the open queue, newest first, with the submitter's display name.
    const open = await store.listSuggestions('sample', 'open');
    const mine = open.find((s) => s.id === 'sg-1');
    expect(mine).toMatchObject({
      kind: 'notify_admin_verify',
      targetRef: 'invoices.customer_ref→accounts.id',
      submittedByName: 'Quinn SG',
      status: 'open',
    });

    // Full record for the accept path.
    expect(await store.getSuggestion('sg-1')).toMatchObject({
      investigationId: 'sg-inv',
      dataSourceId: 'sample',
      answerVersion: 1,
      status: 'open',
      targetItemId: null,
    });

    // Resolve (accept): records the reviewer + which Verified item it mapped to; it
    // leaves the open queue. Scoped by data source — a mismatched id updates nothing
    // (returns false), and the row stays open.
    expect(
      await store.setSuggestionReviewed('other-ds', 'sg-1', {
        status: 'accepted',
        reviewedBy: 'sg-user',
        reviewedAt: new Date(),
      }),
    ).toBe(false);
    expect((await store.getSuggestion('sg-1'))?.status).toBe('open'); // wrong DS → untouched

    expect(
      await store.setSuggestionReviewed('sample', 'sg-1', {
        status: 'accepted',
        targetKind: 'mapping',
        targetItemId: 'map-7',
        reviewedBy: 'sg-user',
        reviewedAt: new Date(),
      }),
    ).toBe(true);
    const resolved = await store.getSuggestion('sg-1');
    expect(resolved).toMatchObject({
      status: 'accepted',
      targetKind: 'mapping',
      targetItemId: 'map-7',
      reviewedBy: 'sg-user',
    });
    expect(resolved?.reviewedAt).not.toBeNull();
    expect((await store.listSuggestions('sample', 'open')).some((s) => s.id === 'sg-1')).toBe(
      false,
    );

    // Conditional on still-open: resolving an already-resolved row updates nothing.
    expect(
      await store.setSuggestionReviewed('sample', 'sg-1', {
        status: 'rejected',
        reviewedBy: 'sg-user',
        reviewedAt: new Date(),
      }),
    ).toBe(false);
    expect((await store.getSuggestion('sg-1'))?.status).toBe('accepted'); // unchanged
  });
});

describe('DrizzleMetadataStore — saveAnswer head guard (M2-B4 ②)', () => {
  it('appends only when expectedLatestVersion still matches the head', async () => {
    await store.createInvestigation({ id: 'inv-hg', dataSourceId: 'sample', title: 'hg' });
    expect(
      (
        await store.saveAnswer({
          investigationId: 'inv-hg',
          question: 'q',
          answer: mkAnswer(1),
          queryRuns: runs,
        })
      ).meta.version,
    ).toBe(1);

    // Head is still 1 → the guarded append succeeds as v2.
    const v2 = await store.saveAnswer({
      investigationId: 'inv-hg',
      answer: mkAnswer(2),
      queryRuns: runs,
      expectedLatestVersion: 1,
    });
    expect(v2.meta.version).toBe(2);

    // Stale: a guarded append that still expects head=1 (a concurrent turn moved it to 2)
    // throws and writes nothing.
    await expect(
      store.saveAnswer({
        investigationId: 'inv-hg',
        answer: mkAnswer(3),
        queryRuns: runs,
        expectedLatestVersion: 1,
      }),
    ).rejects.toThrow(/head moved/i);
    expect((await store.getInvestigation('inv-hg'))?.answers).toHaveLength(2); // no v3
  });
});

describe('DrizzleMetadataStore — createConnectionWithOwnerSource atomicity (#146)', () => {
  it('rolls back the connection + draft source when the final membership insert fails', async () => {
    await store.createUser({
      id: 'tx-user',
      username: 'tx-user',
      displayName: 'Tx',
      passwordHash: 'x',
    });
    const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
    await expect(
      store.createConnectionWithOwnerSource({
        connection: {
          id: 'conn-tx',
          kind: 'postgres',
          name: 'TX',
          host: 'h',
          port: 5432,
          database: 'd',
          sslMode: 'disable',
          credentialBlob: blob,
          health: 'Untested',
          createdBy: 'tx-user',
        },
        membership: { id: 'mem-tx', userId: 'tx-user', connectionId: 'conn-tx', role: 'owner' },
        dataSource: { id: 'ds-tx', name: 'TX', kind: 'postgres', connectionId: 'conn-tx' },
        // The LAST insert references a non-existent user → FK violation after inserts 1–3.
        dataSourceMembership: {
          id: 'dsm-tx',
          userId: 'GHOST',
          dataSourceId: 'ds-tx',
          role: 'owner',
        },
      }),
    ).rejects.toThrow();
    // All four rows rolled back — no orphaned connection, and no owner-less draft source.
    expect(await store.getConnection('conn-tx')).toBeNull();
    expect(await store.getDataSource('ds-tx')).toBeNull();
  });

  it('commits all four rows on success', async () => {
    await store.createUser({
      id: 'tx-ok',
      username: 'tx-ok',
      displayName: 'Ok',
      passwordHash: 'x',
    });
    const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
    const rec = await store.createConnectionWithOwnerSource({
      connection: {
        id: 'conn-ok',
        kind: 'postgres',
        name: 'OK',
        host: 'h',
        port: 5432,
        database: 'd',
        sslMode: 'disable',
        credentialBlob: blob,
        health: 'Untested',
        createdBy: 'tx-ok',
      },
      membership: { id: 'mem-ok', userId: 'tx-ok', connectionId: 'conn-ok', role: 'owner' },
      dataSource: { id: 'ds-ok', name: 'OK', kind: 'postgres', connectionId: 'conn-ok' },
      dataSourceMembership: { id: 'dsm-ok', userId: 'tx-ok', dataSourceId: 'ds-ok', role: 'owner' },
    });
    expect(rec.id).toBe('conn-ok');
    expect(await store.getConnection('conn-ok')).not.toBeNull();
    expect(await store.getDataSourceRole('tx-ok', 'ds-ok')).toBe('owner'); // the load-bearing membership
  });

  it('updates a connection without replacing its draft source', async () => {
    await store.createUser({
      id: 'tx-edit',
      username: 'tx-edit',
      displayName: 'Edit',
      passwordHash: 'x',
    });
    const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
    await store.createConnectionWithOwnerSource({
      connection: {
        id: 'conn-edit',
        kind: 'postgres',
        name: 'Before',
        host: 'h',
        port: 5432,
        database: 'd',
        sslMode: 'disable',
        credentialBlob: blob,
        health: 'Healthy',
        createdBy: 'tx-edit',
      },
      membership: { id: 'mem-edit', userId: 'tx-edit', connectionId: 'conn-edit', role: 'owner' },
      dataSource: { id: 'ds-edit', name: 'Before', kind: 'postgres', connectionId: 'conn-edit' },
      dataSourceMembership: {
        id: 'dsm-edit',
        userId: 'tx-edit',
        dataSourceId: 'ds-edit',
        role: 'owner',
      },
    });
    await store.createDataSource({
      id: 'ds-edit-join',
      name: 'Joined',
      kind: 'postgres',
      connectionId: null,
    });
    await store.upsertDataSourceConnection({
      id: 'dsc-edit',
      dataSourceId: 'ds-edit-join',
      connectionId: 'conn-edit',
      alias: null,
      includedTables: [],
      fieldRules: {},
    });
    await store.setDataSourceLifecycle('ds-edit', 'published');
    await store.setDataSourceLifecycle('ds-edit-join', 'published');

    const updated = await store.updateConnection(
      'conn-edit',
      {
        name: 'After',
        host: 'h2',
        credentialBlob: { ...blob, ciphertext: 'new' },
        health: 'Untested',
      },
      { demoteDataSources: true },
    );

    expect(updated).toMatchObject({
      id: 'conn-edit',
      name: 'After',
      host: 'h2',
      health: 'Untested',
    });
    expect(await store.listDataSourcesByConnection('conn-edit')).toEqual([
      { id: 'ds-edit', name: 'Before' },
    ]);
    expect((await store.getDataSource('ds-edit'))?.lifecycle).toBe('draft');
    expect((await store.getDataSource('ds-edit-join'))?.lifecycle).toBe('draft');
  });
});

describe('DrizzleMetadataStore — invite claim-time expiry + deleteUser (#147)', () => {
  it('redeemDataSourceInvite rejects an expired token at claim time; deleteUser removes the row', async () => {
    await store.createUser({ id: 'iv-u', username: 'iv-u', displayName: 'IV', passwordHash: 'x' });
    // An already-expired invite can't be claimed — the expiry predicate is in the UPDATE.
    await store.createDataSourceInvite({
      id: 'iv-exp',
      dataSourceId: 'sample',
      role: 'querier',
      tokenHash: 'h-exp',
      createdBy: 'iv-u',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await store.redeemDataSourceInvite('iv-exp', 'iv-u', new Date())).toBe(false);

    // A live invite still claims.
    await store.createDataSourceInvite({
      id: 'iv-live',
      dataSourceId: 'sample',
      role: 'querier',
      tokenHash: 'h-live',
      createdBy: 'iv-u',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await store.redeemDataSourceInvite('iv-live', 'iv-u', new Date())).toBe(true);

    // deleteUser removes the account (registration-rollback path).
    await store.createUser({
      id: 'iv-del',
      username: 'iv-del',
      displayName: 'Del',
      passwordHash: 'x',
    });
    expect(await store.getUserByUsername('iv-del')).not.toBeNull();
    await store.deleteUser('iv-del');
    expect(await store.getUserByUsername('iv-del')).toBeNull();
  });
});
