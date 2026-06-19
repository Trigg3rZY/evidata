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
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createSession(session: NewSession): Promise<void>;
  /** The user for a non-expired session token hash, or null (expiry checked in the store). */
  getSessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  // --- M1 connections (spec 08 §6 / 12 §2). Credentials stay encrypted at rest. ---
  createConnection(c: NewConnection): Promise<ConnectionRecord>;
  /** Public summaries (never the credential blob). */
  listConnections(): Promise<ConnectionSummary[]>;
  /** Full record incl. the encrypted blob — internal use (test/introspect); never returned by the API. */
  getConnection(id: string): Promise<ConnectionRecord | null>;
  setConnectionHealth(id: string, health: ConnectionHealth): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  createConnectionMembership(m: ConnectionMembershipInput): Promise<void>;
  /** The user's role on a connection, or null if they have none (authz). */
  getConnectionRole(userId: string, connectionId: string): Promise<ConnectionRole | null>;
  saveSchemaSnapshot(s: NewSchemaSnapshotRecord): Promise<void>;
  getLatestSnapshot(connectionId: string): Promise<SchemaSnapshot | null>;
  createDataSource(ds: NewDataSourceRecord): Promise<void>;
  /** Data Sources backed by a connection — shown before an edit/disable (08 §6). */
  listDataSourcesByConnection(connectionId: string): Promise<Array<{ id: string; name: string }>>;
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

/** A local account (never carries the plaintext password). */
export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  /** Encoded password hash (scrypt) — for verification only; never returned by the API. */
  passwordHash: string;
  createdAt: string;
}

export interface NewUser {
  id: string;
  email: string;
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
