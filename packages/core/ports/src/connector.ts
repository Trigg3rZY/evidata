/**
 * Connector & QueryExecutor ports (spec 01 §2.1).
 *
 * A `Connector` is a data-source endpoint; its `QueryExecutor` runs ONE
 * already-safety-checked, read-only statement against ONE connection. M0 ships
 * the pglite `SampleConnector`; M1 adds `PostgresConnector` behind the same
 * interface, so callers (AgentRunner, etc.) never change.
 */

export interface ColumnMeta {
  name: string;
  /** Postgres type name as reported by the executor, e.g. 'numeric', 'text'. */
  dataType: string;
}

export interface QueryRunResult {
  columns: ColumnMeta[];
  rows: ReadonlyArray<Record<string, unknown>>;
  rowCount: number;
  /** True when the row cap was hit and rows were dropped. */
  truncated: boolean;
  elapsedMs: number;
}

export interface ExecOptions {
  rowLimit: number; // hard cap, enforced by the executor
  timeoutMs: number; // application-enforced per-statement timeout
  statementTimeoutMs?: number; // optional DB-level timeout (defense in depth)
  /** Cancels an in-flight statement (Stop / client disconnect). M1's PostgresExecutor
   *  cancels the backend; M0's in-memory pglite executor ignores it (spec 08 §2.1). */
  signal?: AbortSignal;
}

export interface QueryExecutor {
  /** Executes one already-safety-checked, read-only statement against one connection. */
  run(sql: string, opts: ExecOptions): Promise<QueryRunResult>;
}

// --- Schema snapshot (structural metadata only; the AI never connects) -------

export interface SchemaColumnRef {
  table: string;
  column: string;
}

export interface SchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey?: boolean;
  references?: SchemaColumnRef; // foreign key, if any
  comment?: string;
}

export interface SchemaTable {
  name: string;
  comment?: string;
  columns: SchemaColumn[];
  /** Planner row estimate (pg_class.reltuples), M1 introspection (08 §4). */
  rowEstimate?: number;
  /** Index names on the table, M1 introspection (08 §4). */
  indexes?: string[];
}

export interface SchemaSnapshot {
  dataSourceId: string;
  capturedAt: string; // ISO-8601
  /** True when the snapshot omits some objects (large schemas, M1). */
  partial: boolean;
  tables: SchemaTable[];
}

export interface Connector {
  readonly id: string; // e.g. "sample"
  readonly kind: 'sample' | 'postgres';
  getSchemaSnapshot(): Promise<SchemaSnapshot>;
  getExecutor(): QueryExecutor;
}
