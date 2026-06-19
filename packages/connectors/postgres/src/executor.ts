/**
 * PostgresExecutor (spec 08 §2) — runs ONE already-safety-checked statement against
 * a real Postgres over a bounded, read-only, cancellable session. It is NOT the
 * safety boundary (the SafetyGate runs first); its job is defense-in-depth + bounds:
 *
 *  1. Read-only session: a least-privilege read-only role (the floor) PLUS each
 *     statement wrapped in `BEGIN TRANSACTION READ ONLY … COMMIT` with `SET LOCAL`
 *     statement/idle timeouts (a second floor).
 *  2. Bounds pushed to the server: a `pg-cursor` reads at most `rowLimit + 1` rows
 *     then closes — bounded memory regardless of result size; `truncated` = over cap.
 *  3. Cancellation: on `signal` abort, `pg_cancel_backend` the session's PID via a
 *     side connection and surface an AbortError (name 'AbortError').
 *  4. No credential/PII leak on the error path: connection/auth/TLS failures map to
 *     product-level messages; raw driver text (which can echo host/DSN) never escapes.
 */
import { Client, Pool, type PoolClient } from 'pg';
import Cursor from 'pg-cursor';
import type { ColumnMeta, ExecOptions, QueryExecutor, QueryRunResult } from '@evidata/ports';
import type { PostgresConnectionParams } from './types';

/** Common Postgres type OIDs → readable names; unknown OIDs fall back to `oid:<n>`. */
const OID_TO_NAME: Record<number, string> = {
  16: 'boolean',
  20: 'bigint',
  21: 'smallint',
  23: 'integer',
  25: 'text',
  700: 'real',
  701: 'double precision',
  1042: 'char',
  1043: 'varchar',
  1082: 'date',
  1114: 'timestamp',
  1184: 'timestamptz',
  1700: 'numeric',
  114: 'json',
  3802: 'jsonb',
  2950: 'uuid',
};
const typeName = (oid: number): string => OID_TO_NAME[oid] ?? `oid:${oid}`;

function abortError(): Error {
  const e = new Error('The query was cancelled.');
  e.name = 'AbortError'; // the AgentRunner treats this as cancellation, not a failure
  return e;
}

/** Map a driver error to a safe, product-level Error. SQL errors (bad column, etc.)
 *  keep their message — useful for the model to self-correct and free of host/DSN.
 *  Connection/auth/TLS failures are replaced so nothing leaks (spec 08 §2.4/§7). */
function mapError(err: unknown): Error {
  const code = (err as { code?: string }).code;
  switch (code) {
    case '25006': // read_only_sql_transaction
      return new Error('Read-only violation: the statement attempted to write.');
    case '57014': // query_canceled via statement_timeout (the abort path is handled earlier)
      return new Error('The query exceeded its time limit.');
    case '28P01':
    case '28000': // invalid_password / invalid_authorization
      return new Error('Authentication to the data source failed.');
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
      return new Error('The data source is unreachable.');
    default:
      if (code && /^08/.test(code)) return new Error('Connection to the data source was lost.');
      return new Error(err instanceof Error ? err.message : 'The query could not be executed.');
  }
}

function readCursor(
  cursor: Cursor,
  rowCount: number,
): Promise<{
  rows: Array<Record<string, unknown>>;
  fields: Array<{ name: string; dataTypeID: number }>;
}> {
  return new Promise((resolve, reject) => {
    cursor.read(rowCount, (err, rows, result) => {
      if (err) reject(err);
      else resolve({ rows, fields: result?.fields ?? [] });
    });
  });
}

export class PostgresExecutor implements QueryExecutor {
  private pool: Pool | null = null;

  constructor(private readonly params: PostgresConnectionParams) {}

  /** One pooled, lazily-created connection per Connection (spec 08 §2). */
  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ ...this.params, max: 5, application_name: 'evidata' });
      // A pool 'error' on an idle client would otherwise crash the process.
      this.pool.on('error', () => {});
    }
    return this.pool;
  }

  async run(sql: string, opts: ExecOptions): Promise<QueryRunResult> {
    if (opts.signal?.aborted) throw abortError();
    const client = await this.connect();

    let cancelling = false;
    let pid: number | undefined;
    const onAbort = (): void => {
      cancelling = true;
      if (pid !== undefined) void this.cancelBackend(pid);
    };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

    const start = performance.now();
    const timeout = Math.max(0, Math.floor(opts.statementTimeoutMs ?? opts.timeoutMs));
    try {
      pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
      // The signal may have fired during connect/PID acquisition, before the listener
      // could observe it — recheck before issuing any SQL so a Stop cancels promptly.
      if (opts.signal?.aborted) throw abortError();

      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`);

      const cursor = client.query(new Cursor(sql));
      const { rows: read, fields } = await readCursor(cursor, opts.rowLimit + 1);
      await new Promise<void>((resolve) => cursor.close(() => resolve()));
      await client.query('COMMIT');

      const truncated = read.length > opts.rowLimit;
      const rows = truncated ? read.slice(0, opts.rowLimit) : read;
      const columns: ColumnMeta[] = fields.map((f) => ({
        name: f.name,
        dataType: typeName(f.dataTypeID),
      }));
      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        elapsedMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (cancelling || opts.signal?.aborted) throw abortError();
      throw mapError(err);
    } finally {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      client.release();
    }
  }

  /** Acquire a pooled client, mapping connect-time auth/host/TLS errors so raw pg
   *  text (which can echo host/port/user) never leaks to the model/UI (Codex P2). */
  private async connect(): Promise<PoolClient> {
    try {
      return await this.getPool().connect();
    } catch (err) {
      throw mapError(err);
    }
  }

  /** Cancel the in-flight statement on `pid` via a SIDE connection (the main one is busy). */
  private async cancelBackend(pid: number): Promise<void> {
    const canceller = new Client({ ...this.params, application_name: 'evidata-cancel' });
    try {
      await canceller.connect();
      await canceller.query('SELECT pg_cancel_backend($1)', [pid]);
    } catch {
      /* best effort — the statement may already have finished */
    } finally {
      await canceller.end().catch(() => {});
    }
  }

  /** Close the pool (called when the Connection is removed/replaced). */
  async close(): Promise<void> {
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      await pool.end();
    }
  }
}

export type { PoolClient };
