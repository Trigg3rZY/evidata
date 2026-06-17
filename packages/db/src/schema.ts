/**
 * M0 MetadataStore schema (spec 10 §4).
 *
 * All product metadata lives in its own `evidata_meta` schema, physically
 * separate from any business data (PRD: metadata is never co-located with a
 * business database). pglite speaks Postgres, so this `pg-core` schema is
 * reused verbatim against real Postgres in M1.
 *
 * Storage strategy (spec 10 §3): `answers.payload` is the canonical, validated
 * Answer Contract document; `evidence`/`query_runs` are the normalized,
 * queryable provenance the EvidenceRecorder writes during execution.
 */
import { sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const meta = pgSchema('evidata_meta');

export const investigations = meta.table('investigations', {
  id: text('id').primaryKey(),
  dataSourceId: text('data_source_id').notNull(), // M0: always 'sample'
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const turns = meta.table(
  'turns',
  {
    id: text('id').primaryKey(),
    investigationId: text('investigation_id')
      .notNull()
      .references(() => investigations.id),
    role: text('role', { enum: ['user', 'agent'] }).notNull(),
    question: text('question'), // user turns
    answerVersion: integer('answer_version'), // agent turns → answers.version
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('turns_investigation_idx').on(t.investigationId, t.createdAt)],
);

export const answers = meta.table(
  'answers',
  {
    id: text('id').primaryKey(),
    investigationId: text('investigation_id')
      .notNull()
      .references(() => investigations.id),
    version: integer('version').notNull(), // 1-based, monotonic per investigation
    status: text('status').notNull(), // AnswerStatus (promoted for queries)
    confidence: text('confidence').notNull(), // Confidence (promoted for queries)
    isLatest: boolean('is_latest').notNull(),
    createdAfterKind: text('created_after_kind'), // clarification|followup|rerun|definition_correction
    createdAfterFromVersion: integer('created_after_from_version'),
    payload: jsonb('payload').notNull(), // the validated Answer contract document
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('answers_version_uq').on(t.investigationId, t.version),
    index('answers_latest_idx').on(t.investigationId, t.isLatest),
    // At most one latest head per investigation — enforced by the DB, not just app logic.
    uniqueIndex('answers_one_latest_uq')
      .on(t.investigationId)
      .where(sql`${t.isLatest}`),
  ],
);

export const queryRuns = meta.table(
  'query_runs',
  {
    id: text('id').primaryKey(),
    investigationId: text('investigation_id')
      .notNull()
      .references(() => investigations.id),
    answerVersion: integer('answer_version').notNull(),
    connectorId: text('connector_id').notNull(), // single connection per run
    sql: text('sql').notNull(), // as-executed (post-SafetyGate, post-bounds)
    status: text('status').notNull(), // ok|timeout|connection_lost|zero_rows|error
    rowCount: integer('row_count').notNull(),
    truncated: boolean('truncated').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    // No raw result rows are stored (forward-safe for M1); the redacted sample
    // lives on `evidence` once the result clears the Redactor (spec 10 §3).
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('query_runs_version_idx').on(t.investigationId, t.answerVersion)],
);

export const evidence = meta.table(
  'evidence',
  {
    id: text('id').primaryKey(),
    investigationId: text('investigation_id')
      .notNull()
      .references(() => investigations.id),
    answerVersion: integer('answer_version').notNull(),
    evidenceRef: text('evidence_ref').notNull(), // 'E1' — referenced by keyFindings
    queryRunId: text('query_run_id')
      .notNull()
      .references(() => queryRuns.id),
    purpose: text('purpose').notNull(),
    connectorId: text('connector_id').notNull(),
    tables: jsonb('tables').notNull(), // string[]
    sql: text('sql').notNull(), // policy-bounded, as-executed (PRD D4)
    resultSummary: text('result_summary').notNull(),
    sampleRows: jsonb('sample_rows'), // redacted, capped
    safety: text('safety').notNull(), // auto_executed|confirmed_by_user|rejected
    policyNotes: text('policy_notes').notNull(),
    redactedColumns: jsonb('redacted_columns').notNull(), // string[]
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('evidence_ref_uq').on(t.investigationId, t.answerVersion, t.evidenceRef)],
);

export const suggestions = meta.table('suggestions', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id')
    .notNull()
    .references(() => investigations.id),
  answerVersion: integer('answer_version'),
  kind: text('kind').notNull(), // UnblockActionKind that created it
  targetRef: text('target_ref'), // e.g. 'invoices.customer_ref→accounts.id'
  description: text('description').notNull(),
  status: text('status').notNull().default('recorded'), // M0: always 'recorded'; M2 adds review
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** The full M0 metadata schema, for the migrator and typed queries. */
export const schema = {
  investigations,
  turns,
  answers,
  queryRuns,
  evidence,
  suggestions,
};
