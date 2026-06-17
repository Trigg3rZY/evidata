/**
 * pglite-backed QueryExecutor (spec 01 §2.1, 03 §3 rule 7).
 *
 * Runs ONE already-safety-checked, read-only statement. It is NOT a safety
 * boundary — the SafetyGate runs first and is the guarantee. The executor only
 * bounds results: it caps rows to `rowLimit` (M0 slices in JS — the Sample is
 * tiny and in-memory; M1's PostgresExecutor pushes the LIMIT into SQL) and maps
 * the timeout onto pglite's `statement_timeout` (defense in depth).
 */
import type { PGlite } from '@electric-sql/pglite';
import type { ColumnMeta, ExecOptions, QueryExecutor, QueryRunResult } from '@evidata/ports';

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

export class PgliteQueryExecutor implements QueryExecutor {
  constructor(private readonly client: PGlite) {}

  async run(sql: string, opts: ExecOptions): Promise<QueryRunResult> {
    const timeout = opts.statementTimeoutMs ?? opts.timeoutMs;
    await this.client.query(`SET statement_timeout = ${Math.max(0, Math.floor(timeout))}`);

    const start = performance.now();
    const res = await this.client.query<Record<string, unknown>>(sql);
    const elapsedMs = Math.round(performance.now() - start);

    const all = res.rows;
    const truncated = all.length > opts.rowLimit;
    const rows = truncated ? all.slice(0, opts.rowLimit) : all;
    const columns: ColumnMeta[] = res.fields.map((f) => ({
      name: f.name,
      dataType: typeName(f.dataTypeID),
    }));

    return { columns, rows, rowCount: rows.length, truncated, elapsedMs };
  }
}
