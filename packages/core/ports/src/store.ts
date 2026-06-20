/**
 * MetadataStore port (spec 01 §2.5, spec 10 §5).
 *
 * Persists the conversation-first loop: Investigations, their Turns, every
 * Answer version (append-only), and the QueryRun/Evidence provenance behind
 * each version. The Answer Contract document is the unit persisted; the store
 * is authoritative for version numbering and the single `is_latest` head.
 */
import type { Answer, Investigation, InvestigationWithAnswers } from '@evidata/answer-contract';
import type { SchemaSnapshot } from './connector';
import type { EncryptedSecret } from './secrets';

/** Audit record of one executed query (G4). Shared with the AgentRunner's RunResult. */
export interface QueryRunRecord {
  id: string;
  connectorId: string;
  sql: string;
  /** Execution outcome — every executed statement is recorded, incl. non-`ok` (spec 10 §9). */
  status: 'ok' | 'timeout' | 'connection_lost' | 'zero_rows' | 'error';
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  /** Links to the Evidence item it backs (e.g. "E1"). */
  evidenceRef: string;
}

export interface NewInvestigation {
  id: string;
  dataSourceId: string;
  title: string;
  /** Model bound to this Investigation (epic #106 / #113). Null/omitted = the
   *  server's default model. */
  modelProviderId?: string | null;
}

export interface SaveAnswerInput {
  investigationId: string;
  /** The user turn this answer responds to; omit for a rerun (no new user turn). */
  question?: string;
  answer: Answer;
  queryRuns: QueryRunRecord[];
}

export interface InvestigationListItem {
  id: string;
  title: string;
  dataSourceId: string;
  latestStatus: string;
  updatedAt: string;
}

export interface ListOpts {
  limit?: number;
}

export interface MetadataStore {
  createInvestigation(init: NewInvestigation): Promise<Investigation>;
  /**
   * Persist `answer` as the next version of its Investigation (append-only):
   * computes the version, demotes the prior head, writes the answer document,
   * its QueryRuns and Evidence, and the turn(s) — atomically. Returns the
   * stored answer with authoritative version meta.
   */
  saveAnswer(input: SaveAnswerInput): Promise<Answer>;
  getInvestigation(id: string): Promise<InvestigationWithAnswers | null>;
  /** The model bound to an Investigation (epic #106 / #113), or null if none is
   *  bound or the Investigation doesn't exist. A lightweight read for the follow-up
   *  resolve path (avoids loading the whole thread). */
  getInvestigationModelProviderId(id: string): Promise<string | null>;
  listInvestigations(opts?: ListOpts): Promise<InvestigationListItem[]>;

  // --- M1 identity (spec 08 §5 / 12 §2). Credentials never stored in plaintext. ---
  /** Number of accounts — drives the first-run status (`GET /api/setup`). */
  countUsers(): Promise<number>;
  /**
   * Atomically create the FIRST user (the Owner): inserts only if no user exists,
   * else returns null. The zero-user check + insert happen under one lock so two
   * concurrent first-run requests can't both bootstrap an account (spec 08 §5).
   */
  createFirstUser(user: NewUser): Promise<UserRecord | null>;
  getUserByUsername(username: string): Promise<UserRecord | null>;
  createSession(session: NewSession): Promise<void>;
  /** The user for a non-expired session token hash, or null (expiry checked in the store). */
  getSessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  // --- M1 connections (spec 08 §6 / 12 §2). Credentials stay encrypted at rest. ---
  createConnection(c: NewConnection): Promise<ConnectionRecord>;
  /** Public summaries of the connections this user is a member of (never the blob). */
  listConnections(userId: string): Promise<ConnectionSummary[]>;
  /** Full record incl. the encrypted blob — internal use (test/introspect); never returned by the API. */
  getConnection(id: string): Promise<ConnectionRecord | null>;
  setConnectionHealth(id: string, health: ConnectionHealth): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  createConnectionMembership(m: ConnectionMembershipInput): Promise<void>;
  /** The user's role on a connection, or null if they have none (authz). */
  getConnectionRole(userId: string, connectionId: string): Promise<ConnectionRole | null>;
  saveSchemaSnapshot(s: NewSchemaSnapshotRecord): Promise<void>;
  getLatestSnapshot(connectionId: string): Promise<SchemaSnapshot | null>;

  // --- BYO-key model providers (epic #106). Keys stay encrypted at rest. ---
  createModelProvider(p: NewModelProvider): Promise<ModelProviderRecord>;
  /** Public summaries (never the blob). */
  listModelProviders(): Promise<ModelProviderSummary[]>;
  /** Full record incl. the encrypted blob — internal use (resolve at run time); never returned by the API. */
  getModelProvider(id: string): Promise<ModelProviderRecord | null>;
  deleteModelProvider(id: string): Promise<void>;
  createDataSource(ds: NewDataSourceRecord): Promise<void>;
  /** Data Sources backed by a connection — shown before an edit/disable (08 §6). */
  listDataSourcesByConnection(connectionId: string): Promise<Array<{ id: string; name: string }>>;

  // --- M2 authoring reads (spec 09 §2/§5): resolve a published DataSource → runtime. ---
  /** A DataSource by id (incl. lifecycle), or null. */
  getDataSource(id: string): Promise<DataSourceRecord | null>;
  /** Published, runnable DataSources for the picker (id/name/kind), excluding drafts/archived. */
  listPublishedDataSources(): Promise<Array<{ id: string; name: string; kind: string }>>;
  /** The connection binding for a DataSource (table scope + field rules), or null. */
  getDataSourceConnection(dataSourceId: string): Promise<DataSourceConnectionRecord | null>;
  /** The authored context (overview + payload) for a DataSource, or null. */
  getDataSourceContext(dataSourceId: string): Promise<DataSourceContextRecord | null>;
  /** The safety Policy for a DataSource, or null. */
  getPolicy(dataSourceId: string): Promise<PolicyRecord | null>;
  /** Glossary terms for a DataSource (optionally filtered by status). */
  getGlossaryTerms(dataSourceId: string, status?: GlossaryStatus): Promise<GlossaryTermRecord[]>;
  /** Entity mappings for a DataSource (optionally filtered by status). */
  getEntityMappings(dataSourceId: string, status?: GlossaryStatus): Promise<EntityMappingRecord[]>;

  // --- M2 authoring writes (spec 09 §5/§7). Upserts keyed by the source's unique. ---
  /** Set the connection binding (table scope + field rules) for a DataSource. */
  upsertDataSourceConnection(input: DataSourceConnectionInput): Promise<void>;
  /** Set the authored context (overview + payload) for a DataSource. */
  upsertDataSourceContext(input: DataSourceContextInput): Promise<void>;
  /** Set the safety Policy for a DataSource. */
  upsertPolicy(input: PolicyInput): Promise<void>;
  /** Append glossary terms (e.g. AI calibration drafts as Suggested). No-op on []. */
  addGlossaryTerms(terms: NewGlossaryTerm[]): Promise<void>;
  /** Append entity mappings (e.g. AI calibration drafts as Suggested). No-op on []. */
  addEntityMappings(mappings: NewEntityMapping[]): Promise<void>;
  /** Transition a DataSource's lifecycle (draft → published → archived). */
  setDataSourceLifecycle(dataSourceId: string, lifecycle: DataSourceLifecycle): Promise<void>;
}

export type ConnectionHealth =
  | 'Untested'
  | 'Healthy'
  | 'AuthFailed'
  | 'Unreachable'
  | 'TLSError'
  | 'PermissionInsufficient'
  | 'Disabled';
export type ConnectionRole = 'owner' | 'admin';

export interface NewConnection {
  id: string;
  kind: string;
  name: string;
  host: string;
  port: number;
  database: string;
  sslMode: string;
  credentialBlob: EncryptedSecret;
  health: ConnectionHealth;
  createdBy: string;
}

/** Full stored connection, incl. the encrypted credential blob (internal use only). */
export interface ConnectionRecord extends NewConnection {
  createdAt: string;
  updatedAt: string;
}

/** Public connection shape — what the API returns (no credential blob). */
export interface ConnectionSummary {
  id: string;
  kind: string;
  name: string;
  host: string;
  port: number;
  database: string;
  sslMode: string;
  health: ConnectionHealth;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionMembershipInput {
  id: string;
  userId: string;
  connectionId: string;
  role: ConnectionRole;
}

// --- BYO-key model providers (epic #106). The API key is stored encrypted. ---

export interface ModelParams {
  temperature?: number;
  /** Abstract reasoning effort; the provider adapter maps it per-vendor (epic #106). */
  effort?: string;
  maxTokens?: number;
}

export interface ModelCapabilities {
  /** Drives the agent loop's tool-calling vs structured-output strategy. */
  toolChoice?: 'required' | 'auto' | 'none';
  structuredOutput?: boolean;
}

export interface NewModelProvider {
  id: string;
  name: string;
  /** Provider family for the adapter: 'openai' | 'anthropic' | 'deepseek' | 'openai-compatible' | … */
  kind: string;
  /** For openai-compatible / self-hosted endpoints; null for a vendor default. */
  baseUrl: string | null;
  model: string;
  params: ModelParams;
  capabilities: ModelCapabilities;
  credentialBlob: EncryptedSecret;
  createdBy: string;
}

/** Full stored provider, incl. the encrypted API-key blob (internal use only). */
export interface ModelProviderRecord extends NewModelProvider {
  createdAt: string;
  updatedAt: string;
}

/** Public provider shape — what the API returns (no credential blob). */
export interface ModelProviderSummary {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  model: string;
  params: ModelParams;
  capabilities: ModelCapabilities;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewSchemaSnapshotRecord {
  id: string;
  connectionId: string;
  status: string;
  partial: boolean;
  payload: SchemaSnapshot;
  capturedAt: Date;
}

export interface NewDataSourceRecord {
  id: string;
  name: string;
  kind: string;
  connectionId: string | null;
}

// --- M2 authoring reads (spec 09 §2/§5): resolve a published DataSource → runtime. ---

export type DataSourceLifecycle = 'draft' | 'published' | 'archived';
export type GlossaryStatus = 'suggested' | 'verified';
export type Provenance = 'ai_draft' | 'querier_correction' | 'admin';

/** Per-connection field governance (spec 09 §5); extensible. */
export interface FieldRules {
  /** "table.column" entries the Gate flags + the Redactor masks. */
  sensitiveColumns?: string[];
}

export interface DataSourceRecord {
  id: string;
  name: string;
  kind: string;
  connectionId: string | null;
  description: string | null;
  lifecycle: DataSourceLifecycle;
  createdAt: string;
}

/** A DataSource's connection binding: the AI-visible table scope + field rules. */
export interface DataSourceConnectionRecord {
  id: string;
  dataSourceId: string;
  connectionId: string;
  alias: string | null;
  includedTables: string[];
  fieldRules: FieldRules;
  createdAt: string;
}

export interface DataSourceContextRecord {
  dataSourceId: string;
  overview: string;
  payload: unknown;
  updatedAt: string;
}

export interface PolicyRecord {
  dataSourceId: string;
  rowLimit: number;
  timeoutMs: number;
  statementTimeoutMs: number | null;
  confirmOnBroadScan: boolean;
  confirmOnSensitiveAccess: boolean;
  updatedAt: string;
}

export interface GlossaryTermRecord {
  term: string;
  definition: string;
  status: GlossaryStatus;
  provenance: Provenance;
}

export interface NewGlossaryTerm {
  id: string;
  dataSourceId: string;
  term: string;
  definition: string;
  status: GlossaryStatus;
  provenance: Provenance;
}

export interface EntityMappingRecord {
  fromRef: string;
  toRef: string;
  status: GlossaryStatus;
  provenance: Provenance;
}

export interface NewEntityMapping {
  id: string;
  dataSourceId: string;
  fromRef: string;
  toRef: string;
  status: GlossaryStatus;
  provenance: Provenance;
}

// --- M2 authoring writes (spec 09 §5/§7) ---

export interface DataSourceConnectionInput {
  id: string;
  dataSourceId: string;
  connectionId: string;
  alias: string | null;
  includedTables: string[];
  fieldRules: FieldRules;
}

export interface DataSourceContextInput {
  id: string;
  dataSourceId: string;
  overview: string;
  payload: unknown;
}

export interface PolicyInput {
  id: string;
  dataSourceId: string;
  rowLimit: number;
  timeoutMs: number;
  statementTimeoutMs: number | null;
  confirmOnBroadScan: boolean;
  confirmOnSensitiveAccess: boolean;
}

/** A local account (never carries the plaintext password). */
export interface UserRecord {
  id: string;
  /** Login identifier (username-style; not RFC-email-enforced). */
  username: string;
  displayName: string;
  /** Encoded password hash (scrypt) — for verification only; never returned by the API. */
  passwordHash: string;
  createdAt: string;
}

export interface NewUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

export interface NewSession {
  id: string;
  userId: string;
  /** SHA-256 of the cookie token; the raw token is never stored. */
  tokenHash: string;
  expiresAt: Date;
}
