/**
 * Real-Postgres metadata host (#88). Gated on TEST_DATABASE_URL so local/unit runs
 * stay hermetic; CI provides a Postgres service container.
 */
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Answer } from '@evidata/answer-contract';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from './index';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const run = describe.skipIf(!ADMIN_URL);
const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrateScript = resolve(repoRoot, 'packages/db/scripts/migrate.mjs');

function mkAnswer(): Answer {
  return {
    investigationId: 'pg-meta-inv',
    status: 'Answered',
    directAnswer: 'Spend rose.',
    confidence: 'High',
    confidenceReason: 'single source of truth',
    keyFindings: [{ text: 'spend rose', evidenceIds: ['E1'] }],
    evidence: [
      {
        id: 'E1',
        purpose: 'compare',
        dataSourceId: 'pg-meta-ds',
        dataSourceName: 'Postgres metadata',
        connectorId: 'sample',
        tables: ['campaign_spend'],
        sql: 'select 1',
        resultSummary: '1 row',
        execution: { status: 'ok', elapsedMs: 1, rowCount: 1, truncated: false },
        safety: 'auto_executed',
        policyNotes: 'read-only',
        redactedColumns: [],
      },
    ],
    assumptions: [],
    caveats: [],
    recommendedFollowups: [],
    meta: { version: 0, createdAt: '2026-06-17T00:00:00Z', isLatest: true },
  };
}

run('Postgres metadata host (#88)', () => {
  const databaseUrl = ADMIN_URL as string;
  let admin: Client;
  let handle: MetadataDbHandle | undefined;

  beforeAll(async () => {
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS evidata_meta CASCADE');
    await admin.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  });

  afterAll(async () => {
    await handle?.close();
    if (admin) {
      await admin.query('DROP SCHEMA IF EXISTS evidata_meta CASCADE').catch(() => {});
      await admin.query('DROP SCHEMA IF EXISTS drizzle CASCADE').catch(() => {});
      await admin.end();
    }
  });

  it('migrates via db:migrate and uses node-postgres through the shared store', async () => {
    await execFileAsync(process.execPath, [migrateScript], {
      cwd: repoRoot,
      env: { ...process.env, METADATA_DATABASE_URL: databaseUrl },
    });

    const migrated = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(migrated.rows[0]?.n).toBeGreaterThan(0);

    handle = await createMetadataDb({ databaseUrl });
    expect(handle.kind).toBe('postgres');
    const store = new DrizzleMetadataStore(handle.db, {
      now: () => new Date('2026-06-17T00:00:00Z'),
      newId: (() => {
        let n = 0;
        return () => `pg-meta-${(n += 1)}`;
      })(),
    });

    await store.createDataSource({
      id: 'pg-meta-ds',
      name: 'PG Meta',
      kind: 'sample',
      connectionId: null,
    });
    await store.createInvestigation({
      id: 'pg-meta-inv',
      dataSourceId: 'pg-meta-ds',
      title: 'Postgres metadata',
    });
    const saved = await store.saveAnswer({
      investigationId: 'pg-meta-inv',
      question: 'why up?',
      answer: mkAnswer(),
      queryRuns: [
        {
          id: 'qr',
          connectorId: 'sample',
          sql: 'select 1',
          status: 'ok',
          rowCount: 1,
          truncated: false,
          elapsedMs: 1,
          evidenceRef: 'E1',
        },
      ],
    });

    expect(saved.meta.version).toBe(1);
    expect((await store.getInvestigation('pg-meta-inv'))?.answers).toHaveLength(1);
  });
});
