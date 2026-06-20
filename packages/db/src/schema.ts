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
  // M1 (spec 12 §3): now a real FK to data_sources; the migration seeds the
  // built-in Sample row so existing 'sample' rows satisfy the constraint.
  dataSourceId: text('data_source_id')
    .notNull()
    .references(() => dataSources.id),
  title: text('title').notNull(),
  // The registered model bound to this Investigation at creation (epic #106 / #113):
  // follow-ups reuse it so a conversation never switches models, and it records which
  // model answered for audit. Null = the deployment's env-configured default (not
  // snapshotted — a follow-up then uses the current env default; immutable env-default
  // audit is #116). No FK — the raw id is kept for audit even if the provider is deleted.
  modelProviderId: text('model_provider_id'),
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

// --- M1 additions: identity, connections, snapshots, data sources (spec 12 §2) ---

export const users = meta.table(
  'users',
  {
    id: text('id').primaryKey(),
    // The login identifier (username-style; not RFC-email-enforced). The physical
    // column stays "email" for legacy reasons — no migration needed; an optional
    // notification email can be added as a separate column later (spec 08 §5).
    username: text('email').notNull(),
    passwordHash: text('password_hash').notNull(), // scrypt (08 §5)
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.username)],
);

export const sessions = meta.table(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(), // SHA-256 of the cookie token; never the token
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const connections = meta.table('connections', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // 'postgres'
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  database: text('database').notNull(),
  sslMode: text('ssl_mode').notNull(), // 'require' | 'verify-full' | 'disable' | …
  credentialBlob: jsonb('credential_blob').notNull(), // EncryptedSecret (08 §3) — never returned
  health: text('health').notNull(), // Connection state machine (08 §7)
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const connectionMemberships = meta.table(
  'connection_memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    role: text('role', { enum: ['owner', 'admin'] }).notNull(),
  },
  (t) => [uniqueIndex('conn_member_uq').on(t.userId, t.connectionId)],
);

export const schemaSnapshots = meta.table(
  'schema_snapshots',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    status: text('status').notNull(), // 'complete' | 'partial' | 'failed'
    partial: boolean('partial').notNull(),
    payload: jsonb('payload').notNull(), // the SchemaSnapshot document (08 §4)
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('snapshots_connection_idx').on(t.connectionId, t.capturedAt)],
);

// BYO-key model providers (epic #106): a user-configured LLM endpoint + encrypted
// API key. The agent's AgentProvider resolves the chosen one; safety is
// model-independent (the app validates/executes regardless of which model proposed).
export const modelProviders = meta.table('model_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // display name, e.g. "Team DeepSeek"
  kind: text('kind').notNull(), // 'openai' | 'anthropic' | 'deepseek' | 'openai-compatible' | …
  baseUrl: text('base_url'), // nullable; for openai-compatible / self-hosted endpoints
  model: text('model').notNull(), // e.g. 'deepseek-chat'
  params: jsonb('params').notNull(), // { temperature?, effort?, maxTokens? }
  capabilities: jsonb('capabilities').notNull(), // { toolChoice?, structuredOutput? }
  credentialBlob: jsonb('credential_blob').notNull(), // EncryptedSecret (the API key) — never returned
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// Data Source — the governed, AI-facing surface. M1 shipped the minimal row; M2
// adds description + lifecycle and the authoring tables below (spec 09 §5).
export const dataSources = meta.table('data_sources', {
  id: text('id').primaryKey(), // 'sample' for the built-in Sample
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'sample' | 'postgres'
  connectionId: text('connection_id').references(() => connections.id), // M1 legacy; M2 uses the join
  description: text('description'),
  lifecycle: text('lifecycle').notNull().default('draft'), // 'draft' | 'published' | 'archived'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- M2 authoring tables (spec 09 §5) ---

export const dataSourceConnections = meta.table(
  'data_source_connections',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    alias: text('alias'),
    includedTables: jsonb('included_tables').notNull(), // string[] — the AI-visible scope
    fieldRules: jsonb('field_rules').notNull(), // { sensitiveColumns: string[]; … }
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('ds_conn_uq').on(t.dataSourceId, t.connectionId)],
);

export const dataSourceContexts = meta.table('data_source_contexts', {
  id: text('id').primaryKey(),
  dataSourceId: text('data_source_id')
    .notNull()
    .references(() => dataSources.id)
    .unique(),
  overview: text('overview').notNull().default(''),
  payload: jsonb('payload').notNull(), // entities/relationships/examples (AI draft + verified)
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const businessGlossaryTerms = meta.table(
  'business_glossary_terms',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    term: text('term').notNull(),
    definition: text('definition').notNull(),
    status: text('status', { enum: ['suggested', 'verified'] }).notNull(),
    provenance: text('provenance', {
      enum: ['ai_draft', 'querier_correction', 'admin'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('glossary_ds_idx').on(t.dataSourceId)],
);

export const entityMappings = meta.table(
  'entity_mappings',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    fromRef: text('from_ref').notNull(),
    toRef: text('to_ref').notNull(),
    status: text('status', { enum: ['suggested', 'verified'] }).notNull(),
    provenance: text('provenance', {
      enum: ['ai_draft', 'querier_correction', 'admin'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('mappings_ds_idx').on(t.dataSourceId)],
);

export const policies = meta.table('policies', {
  id: text('id').primaryKey(),
  dataSourceId: text('data_source_id')
    .notNull()
    .references(() => dataSources.id)
    .unique(),
  rowLimit: integer('row_limit').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
  statementTimeoutMs: integer('statement_timeout_ms'),
  confirmOnBroadScan: boolean('confirm_on_broad_scan').notNull(),
  confirmOnSensitiveAccess: boolean('confirm_on_sensitive_access').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const dataSourceMemberships = meta.table(
  'data_source_memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    role: text('role', { enum: ['owner', 'admin', 'querier'] }).notNull(),
  },
  (t) => [uniqueIndex('ds_member_uq').on(t.userId, t.dataSourceId)],
);

// Single-use, expiring invite to join a Data Source with a role (M2-B1b, #121).
// Only the SHA-256 hash of the opaque token is stored (like sessions); single-use =
// redeemedAt set on claim. No FK from token to user (the redeemer may be created on
// redeem). createdBy/redeemedBy reference users for audit.
export const dataSourceInvites = meta.table(
  'data_source_invites',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id),
    role: text('role', { enum: ['owner', 'admin', 'querier'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedBy: text('redeemed_by').references(() => users.id),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('ds_invite_token_uq').on(t.tokenHash),
    index('ds_invite_ds_idx').on(t.dataSourceId),
  ],
);

/** The full metadata schema (M0 + M1 + M2), for the migrator and typed queries. */
export const schema = {
  investigations,
  turns,
  answers,
  queryRuns,
  evidence,
  suggestions,
  users,
  sessions,
  connections,
  connectionMemberships,
  schemaSnapshots,
  modelProviders,
  dataSources,
  dataSourceConnections,
  dataSourceContexts,
  businessGlossaryTerms,
  entityMappings,
  policies,
  dataSourceMemberships,
  dataSourceInvites,
};
