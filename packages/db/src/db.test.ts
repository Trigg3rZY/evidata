import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { createMetadataDb, type MetadataDbHandle } from './client';
import { MIGRATIONS } from './schema-sql';
import { DrizzleMetadataStore } from './store';
import {
  answers,
  businessGlossaryTerms,
  connectionMemberships,
  connections,
  dataSourceConnections,
  dataSourceContexts,
  dataSourceMemberships,
  dataSources,
  entityMappings,
  evidence,
  investigations,
  policies,
  queryRuns,
  schemaSnapshots,
  sessions,
  users,
} from './schema';

let handle: MetadataDbHandle;

beforeAll(async () => {
  handle = await createMetadataDb(); // in-memory, migrations applied
});

afterAll(async () => {
  await handle.close();
});

const at = (iso: string): Date => new Date(iso);

describe('M0 metadata schema (spec 10)', () => {
  it('migrates the M0 + M1 + M2 tables into the evidata_meta schema', async () => {
    const res = await handle.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'evidata_meta' order by table_name`,
    );
    expect(res.rows.map((r) => r.table_name)).toEqual([
      'answers',
      'business_glossary_terms',
      'connection_memberships',
      'connections',
      'data_source_connections',
      'data_source_contexts',
      'data_source_invites',
      'data_source_memberships',
      'data_sources',
      'entity_mappings',
      'evidence',
      'investigations',
      'model_providers',
      'policies',
      'query_runs',
      'schema_snapshots',
      'sessions',
      'suggestions',
      'turns',
      'users',
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

  it('rejects a second is_latest head per investigation (partial unique index)', async () => {
    const { db } = handle;
    // inv1 already has ans2 as its latest head; a second latest row must be rejected.
    await expect(
      db.insert(answers).values({
        id: 'ans-second-head',
        investigationId: 'inv1',
        version: 99,
        status: 'Answered',
        confidence: 'High',
        isLatest: true,
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

describe('file-backed metadata persistence (spec 08 §9)', () => {
  it('reuses a persisted dataDir across restarts (idempotent schema apply)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidata-meta-'));
    try {
      const h1 = await createMetadataDb({ dataDir: dir });
      await new DrizzleMetadataStore(h1.db).createFirstUser({
        id: 'p1',
        username: 'persist@example.com',
        displayName: 'P',
        passwordHash: 'x',
      });
      await h1.close();

      // Reopen the same dir — the schema must NOT be re-applied, and data persists.
      const h2 = await createMetadataDb({ dataDir: dir });
      expect(await new DrizzleMetadataStore(h2.db).countUsers()).toBe(1);
      await h2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a pre-journal dataDir: applies only the newer migration (#90/P1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidata-upgrade-'));
    try {
      // Simulate a database created before the migration journal: apply the
      // migrations up to and including the one that creates `data_sources`, with NO
      // journal table (how the client behaved before this fix).
      const old = new PGlite(dir);
      for (const m of MIGRATIONS) {
        await old.exec(`BEGIN;\n${m.sql}\nCOMMIT;`);
        if (m.sql.includes('CREATE TABLE "evidata_meta"."data_sources"')) break;
      }
      const lifecycleQ = `SELECT 1 FROM information_schema.columns
        WHERE table_schema='evidata_meta' AND table_name='data_sources' AND column_name='lifecycle'`;
      expect((await old.query(lifecycleQ)).rows).toHaveLength(0); // pre-M2: no lifecycle
      await old.close();

      // Reopen via createMetadataDb → adopts the baseline and applies the M2 migration.
      const h = await createMetadataDb({ dataDir: dir });
      expect((await h.client.query(lifecycleQ)).rows).toHaveLength(1); // M2 column added
      const journal = await h.client.query<{ name: string }>(
        `SELECT name FROM public._evidata_migrations`,
      );
      expect(journal.rows).toHaveLength(MIGRATIONS.length); // every migration now recorded
      await h.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('M1 metadata schema (spec 12)', () => {
  it('seeds the built-in Sample data source', async () => {
    const rows = await handle.db.select().from(dataSources).where(eq(dataSources.id, 'sample'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('sample');
    expect(rows[0]?.connectionId).toBeNull();
  });

  it('makes investigations.data_source_id a real FK (rejects an unknown source)', async () => {
    await expect(
      handle.db.insert(investigations).values({
        id: 'inv-bad-source',
        dataSourceId: 'no-such-source',
        title: 'orphan',
        createdAt: at('2026-06-02T00:00:00Z'),
        updatedAt: at('2026-06-02T00:00:00Z'),
      }),
    ).rejects.toThrow();
  });

  it('enforces unique user email and FK-bound sessions/connections', async () => {
    const { db } = handle;
    await db.insert(users).values({
      id: 'u1',
      username: 'owner@example.com',
      passwordHash: 'argon2id$…',
      displayName: 'Owner',
      createdAt: at('2026-06-02T00:00:00Z'),
    });
    // Duplicate email rejected.
    await expect(
      db.insert(users).values({
        id: 'u2',
        username: 'owner@example.com',
        passwordHash: 'x',
        displayName: 'Dup',
        createdAt: at('2026-06-02T00:00:01Z'),
      }),
    ).rejects.toThrow();
    // A session for a non-existent user is rejected by the FK.
    await expect(
      db.insert(sessions).values({
        id: 's-orphan',
        userId: 'ghost',
        tokenHash: 'h1',
        createdAt: at('2026-06-02T00:00:02Z'),
        expiresAt: at('2026-06-03T00:00:02Z'),
      }),
    ).rejects.toThrow();
  });

  it('binds connections/snapshots/data sources to their parents; unique membership', async () => {
    const { db } = handle;
    await db.insert(connections).values({
      id: 'c1',
      kind: 'postgres',
      name: 'Warehouse',
      host: 'db.internal',
      port: 5432,
      database: 'analytics',
      sslMode: 'require',
      credentialBlob: { v: 1, keyId: 'k1', iv: 'x', ciphertext: 'y', authTag: 'z' },
      health: 'Untested',
      createdBy: 'u1',
      createdAt: at('2026-06-02T00:00:03Z'),
      updatedAt: at('2026-06-02T00:00:03Z'),
    });
    await db.insert(schemaSnapshots).values({
      id: 'snap1',
      connectionId: 'c1',
      status: 'complete',
      partial: false,
      payload: { tables: [] },
      capturedAt: at('2026-06-02T00:00:04Z'),
    });
    await db.insert(dataSources).values({
      id: 'ds-wh',
      name: 'Warehouse',
      kind: 'postgres',
      connectionId: 'c1',
      createdAt: at('2026-06-02T00:00:05Z'),
    });
    await db.insert(connectionMemberships).values({
      id: 'm1',
      userId: 'u1',
      connectionId: 'c1',
      role: 'owner',
    });
    // One membership per (user, connection).
    await expect(
      db.insert(connectionMemberships).values({
        id: 'm-dup',
        userId: 'u1',
        connectionId: 'c1',
        role: 'admin',
      }),
    ).rejects.toThrow();
    // A connection created by an unknown user is rejected by the FK.
    await expect(
      db.insert(connections).values({
        id: 'c-orphan',
        kind: 'postgres',
        name: 'Bad',
        host: 'h',
        port: 5432,
        database: 'd',
        sslMode: 'require',
        credentialBlob: {},
        health: 'Untested',
        createdBy: 'ghost',
        createdAt: at('2026-06-02T00:00:06Z'),
        updatedAt: at('2026-06-02T00:00:06Z'),
      }),
    ).rejects.toThrow();
  });
});

describe('M2 metadata schema (spec 09)', () => {
  // Reuses u1 + c1 + ds-wh created by the M1 block above.
  it('seeds the Sample as Published; a new Data Source defaults to Draft', async () => {
    const [sample] = await handle.db.select().from(dataSources).where(eq(dataSources.id, 'sample'));
    expect(sample?.lifecycle).toBe('published');
    const [wh] = await handle.db.select().from(dataSources).where(eq(dataSources.id, 'ds-wh'));
    expect(wh?.lifecycle).toBe('draft'); // new rows default to draft
    expect(wh?.description).toBeNull();
  });

  it('attaches a connection with scope; one row per (data source, connection)', async () => {
    const { db } = handle;
    await db.insert(dataSourceConnections).values({
      id: 'dsc1',
      dataSourceId: 'ds-wh',
      connectionId: 'c1',
      alias: null,
      includedTables: ['public.orders', 'public.customers'],
      fieldRules: { sensitiveColumns: ['public.customers.email'] },
      createdAt: at('2026-06-03T00:00:00Z'),
    });
    const [row] = await db
      .select()
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.dataSourceId, 'ds-wh'));
    expect(row?.includedTables).toEqual(['public.orders', 'public.customers']);
    // Unique (data source, connection).
    await expect(
      db.insert(dataSourceConnections).values({
        id: 'dsc-dup',
        dataSourceId: 'ds-wh',
        connectionId: 'c1',
        alias: null,
        includedTables: [],
        fieldRules: {},
        createdAt: at('2026-06-03T00:00:01Z'),
      }),
    ).rejects.toThrow();
  });

  it('keeps one context and one policy per Data Source (unique)', async () => {
    const { db } = handle;
    await db.insert(dataSourceContexts).values({
      id: 'ctx1',
      dataSourceId: 'ds-wh',
      overview: 'Orders + customers.',
      payload: { entities: [] },
      updatedAt: at('2026-06-03T00:00:02Z'),
    });
    await expect(
      db.insert(dataSourceContexts).values({
        id: 'ctx-dup',
        dataSourceId: 'ds-wh',
        overview: 'dup',
        payload: {},
        updatedAt: at('2026-06-03T00:00:03Z'),
      }),
    ).rejects.toThrow();

    await db.insert(policies).values({
      id: 'pol1',
      dataSourceId: 'ds-wh',
      rowLimit: 1000,
      timeoutMs: 5000,
      statementTimeoutMs: 5000,
      confirmOnBroadScan: true,
      confirmOnSensitiveAccess: true,
      updatedAt: at('2026-06-03T00:00:04Z'),
    });
    await expect(
      db.insert(policies).values({
        id: 'pol-dup',
        dataSourceId: 'ds-wh',
        rowLimit: 10,
        timeoutMs: 1000,
        statementTimeoutMs: null,
        confirmOnBroadScan: false,
        confirmOnSensitiveAccess: false,
        updatedAt: at('2026-06-03T00:00:05Z'),
      }),
    ).rejects.toThrow();
  });

  it('records glossary/mapping with status+provenance; unique data-source membership', async () => {
    const { db } = handle;
    await db.insert(businessGlossaryTerms).values({
      id: 'g1',
      dataSourceId: 'ds-wh',
      term: 'active customer',
      definition: "status = 'active'",
      status: 'suggested',
      provenance: 'ai_draft',
      createdAt: at('2026-06-03T00:00:06Z'),
    });
    await db.insert(entityMappings).values({
      id: 'em1',
      dataSourceId: 'ds-wh',
      fromRef: 'Customer',
      toRef: 'public.customers.id',
      status: 'verified',
      provenance: 'admin',
      createdAt: at('2026-06-03T00:00:07Z'),
    });
    expect(
      (await db.select().from(businessGlossaryTerms).where(eq(businessGlossaryTerms.id, 'g1')))[0]
        ?.status,
    ).toBe('suggested');

    await db.insert(dataSourceMemberships).values({
      id: 'dsm1',
      userId: 'u1',
      dataSourceId: 'ds-wh',
      role: 'owner',
    });
    await expect(
      db.insert(dataSourceMemberships).values({
        id: 'dsm-dup',
        userId: 'u1',
        dataSourceId: 'ds-wh',
        role: 'admin',
      }),
    ).rejects.toThrow();
  });
});
