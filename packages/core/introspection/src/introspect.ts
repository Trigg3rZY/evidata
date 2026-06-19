/**
 * IntrospectionService (spec 08 §4) — connects **app-side** (the AI never connects)
 * with the Connection's read-only role and reads structural metadata only:
 * tables/columns/types/nullability, comments, row estimates, primary & foreign
 * keys, and index names → a `SchemaSnapshot`. User schemas only (system schemas
 * excluded). Large schemas are capped and flagged `partial` (no silent truncation).
 *
 * It reads no data rows — only the catalog — so it is not on the trusted-answer
 * execution path; the result is stored (M1.6) and served to the agent as
 * `AgentInput.schema`.
 */
import { Client } from 'pg';
import type { PostgresConnectionParams } from '@evidata/connector-postgres';
import type { SchemaColumn, SchemaSnapshot, SchemaTable } from '@evidata/ports';

// User schemas only — exclude the Postgres system schemas.
const USER_SCHEMAS = `n.nspname NOT IN ('pg_catalog', 'information_schema') AND left(n.nspname, 3) <> 'pg_'`;
// Ordinary + partitioned tables, views, materialized views.
const RELKINDS = `c.relkind IN ('r', 'p', 'v', 'm')`;

export interface IntrospectionOptions {
  /** Cap on tables captured; beyond it the snapshot is `partial` (08 §4). */
  maxTables?: number;
  now?: () => Date;
}

interface TableRow {
  oid: string; // relation OID (as text) — used to scope dependent queries
  schema: string;
  table_name: string;
  comment: string | null;
  row_estimate: string | null; // bigint → string over the wire
}
interface ColumnRow {
  schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  nullable: boolean;
  comment: string | null;
}
interface KeyRow {
  schema: string;
  table_name: string;
  column_name: string;
}
interface FkRow extends KeyRow {
  ref_schema: string;
  ref_table: string;
  ref_column: string;
}
interface IndexRow {
  schema: string;
  table_name: string;
  index_name: string;
}

/** Qualify a relation: bare in `public`, else `schema.table` (matches SafetyGate). */
const qualify = (schema: string, table: string): string =>
  schema === 'public' ? table : `${schema}.${table}`;

export class IntrospectionService {
  async capture(
    params: PostgresConnectionParams,
    dataSourceId: string,
    opts: IntrospectionOptions = {},
  ): Promise<SchemaSnapshot> {
    const maxTables = opts.maxTables ?? 500;
    const now = opts.now ?? (() => new Date());
    const client = new Client({ ...params, application_name: 'evidata-introspect' });
    await client.connect();
    try {
      // Cap server-side: order, take maxTables (read +1 to detect overflow → partial).
      const tableRes = await client.query<TableRow>(
        `SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS table_name,
                obj_description(c.oid) AS comment, c.reltuples::bigint AS row_estimate
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE ${RELKINDS} AND ${USER_SCHEMAS}
         ORDER BY n.nspname, c.relname
         LIMIT ${maxTables + 1}`,
      );
      const partial = tableRes.rows.length > maxTables;
      const kept = partial ? tableRes.rows.slice(0, maxTables) : tableRes.rows;
      const keptOids = kept.map((t) => t.oid);

      // All dependent metadata is scoped to the kept relations — don't scan the whole
      // catalog when a large schema is capped (Codex P2). Sequential, not Promise.all:
      // a single pg Client serializes queries anyway.
      const scoped = `c.oid = ANY($1::oid[])`;
      const cols = await client.query<ColumnRow>(
        `SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS nullable, col_description(c.oid, a.attnum) AS comment
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attnum > 0 AND NOT a.attisdropped AND ${scoped}
         ORDER BY n.nspname, c.relname, a.attnum`,
        [keptOids],
      );
      const pks = await client.query<KeyRow>(
        `SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS column_name
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
         WHERE con.contype = 'p' AND ${scoped}`,
        [keptOids],
      );
      // Composite FKs: unnest conkey/confkey in parallel so EVERY column pair is
      // recorded (each local column gets its own reference), not just the first (Codex P2).
      const fks = await client.query<FkRow>(
        `SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS column_name,
                fn.nspname AS ref_schema, fc.relname AS ref_table, fa.attname AS ref_column
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class fc ON fc.oid = con.confrelid
         JOIN pg_namespace fn ON fn.oid = fc.relnamespace
         JOIN LATERAL unnest(con.conkey, con.confkey) AS k(local_attnum, ref_attnum) ON true
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.local_attnum
         JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = k.ref_attnum
         WHERE con.contype = 'f' AND ${scoped}`,
        [keptOids],
      );
      const idx = await client.query<IndexRow>(
        `SELECT n.nspname AS schema, c.relname AS table_name, i.relname AS index_name
         FROM pg_index x
         JOIN pg_class c ON c.oid = x.indrelid
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE ${scoped}
         ORDER BY n.nspname, c.relname, i.relname`,
        [keptOids],
      );

      const pkSet = new Set(pks.rows.map((r) => `${r.schema}.${r.table_name}.${r.column_name}`));
      const fkMap = new Map<string, FkRow>();
      for (const r of fks.rows) fkMap.set(`${r.schema}.${r.table_name}.${r.column_name}`, r);
      const idxByTable = new Map<string, string[]>();
      for (const r of idx.rows) {
        const key = `${r.schema}.${r.table_name}`;
        const list = idxByTable.get(key) ?? [];
        list.push(r.index_name);
        idxByTable.set(key, list);
      }

      const tableMap = new Map<string, SchemaTable>();
      for (const t of kept) {
        const table: SchemaTable = {
          name: qualify(t.schema, t.table_name),
          columns: [],
          ...(t.comment ? { comment: t.comment } : {}),
          ...(t.row_estimate !== null ? { rowEstimate: Math.max(0, Number(t.row_estimate)) } : {}),
        };
        tableMap.set(`${t.schema}.${t.table_name}`, table);
      }

      for (const c of cols.rows) {
        const table = tableMap.get(`${c.schema}.${c.table_name}`);
        if (!table) continue; // out of the capped scope
        const colKey = `${c.schema}.${c.table_name}.${c.column_name}`;
        const fk = fkMap.get(colKey);
        const column: SchemaColumn = {
          name: c.column_name,
          dataType: c.data_type,
          nullable: c.nullable,
          ...(pkSet.has(colKey) ? { primaryKey: true } : {}),
          ...(fk
            ? { references: { table: qualify(fk.ref_schema, fk.ref_table), column: fk.ref_column } }
            : {}),
          ...(c.comment ? { comment: c.comment } : {}),
        };
        table.columns.push(column);
      }

      for (const [key, names] of idxByTable) {
        const table = tableMap.get(key);
        if (table && names.length) table.indexes = names;
      }

      return {
        dataSourceId,
        capturedAt: now().toISOString(),
        partial,
        tables: [...tableMap.values()],
      };
    } finally {
      await client.end();
    }
  }
}
