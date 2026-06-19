/**
 * Deterministic SQL Safety Gate (spec 03 §3).
 *
 * Parses with `pgsql-ast-parser` and decides on the AST — never on regex. The
 * gate is mandatory and the AgentProvider cannot override a `reject`. It fails
 * closed: anything it cannot parse or recognise is rejected.
 *
 * Notes on this parser version (pgsql-ast-parser@12):
 * - `SET ROLE`, `VACUUM`, `ANALYZE`, `COPY`, `WITH RECURSIVE`, and `SELECT INTO`
 *   are not modelled and therefore parse-fail → rejected as `unparseable`. That
 *   is safe (fail-closed). Denylisted *functions* inside otherwise-valid SQL are
 *   parseable and are rejected as `admin_or_maintenance`.
 * - `EXPLAIN` is also not modelled, so it is recognised lexically and stripped
 *   (see `stripExplain`); the inner statement is then validated by the normal AST
 *   pipeline. `EXPLAIN ANALYZE` executes the statement and is rejected.
 * - Data-modifying CTEs (`WITH x AS (DELETE … RETURNING …) SELECT …`) parse as a
 *   `with` whose bind statement is `delete`/`insert`/`update`; the read-only
 *   check recurses into every CTE body to catch this bypass.
 */
import { astVisitor, parse, type Statement } from 'pgsql-ast-parser';
import type { SafetyContext, SafetyDecision, SafetyGate, SafetyRejectReason } from '@evidata/ports';

/** Functions that read the filesystem, reach other systems, or mutate state. */
const DENY_EXACT = new Set<string>([
  'dblink',
  'dblink_exec',
  'pg_ls_dir',
  'pg_stat_file',
  'pg_sleep',
  'pg_terminate_backend',
  'pg_reload_conf',
  'pg_read_server_files',
  'set_config',
]);
const DENY_PREFIX = ['lo_', 'pg_read_file', 'pg_read_binary_file', 'dblink'];

function isDeniedFunction(name: string): boolean {
  const n = name.toLowerCase();
  return DENY_EXACT.has(n) || DENY_PREFIX.some((p) => n.startsWith(p));
}

function reject(reason: SafetyRejectReason, detail: string): SafetyDecision {
  return { verdict: 'reject', reason, detail };
}

/**
 * Recognise and strip a leading `EXPLAIN` (which `pgsql-ast-parser` does not
 * model) so the inner statement can be validated by the normal AST pipeline.
 *
 * This is the ONLY lexical step in the gate, and it makes no safety decision:
 * the inner statement is fully re-validated on its AST (read-only recursion,
 * table authorization, function denylist). A mis-strip can only yield a
 * statement that fails to parse (→ rejected), never an unsafe execution.
 * `EXPLAIN ANALYZE` actually executes the statement, so it is rejected.
 */
function stripExplain(sql: string): { inner: string; analyze: boolean } | null {
  const m = /^\s*explain\b/i.exec(sql);
  if (!m) return null;

  let rest = sql.slice(m[0].length).replace(/^\s+/, '');
  let analyze = false;

  if (rest.startsWith('(')) {
    // Parenthesised option list, e.g. EXPLAIN (ANALYZE, FORMAT JSON) SELECT …
    let depth = 0;
    let close = -1;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) return { inner: '', analyze: false }; // unbalanced → inner empty → unparseable
    if (/\banalyze\b/i.test(rest.slice(1, close))) analyze = true;
    rest = rest.slice(close + 1).replace(/^\s+/, '');
  } else {
    // Bare options, e.g. EXPLAIN ANALYZE VERBOSE SELECT …
    const optRe = /^(analyze|verbose)\b\s*/i;
    let mm: RegExpExecArray | null;
    while ((mm = optRe.exec(rest))) {
      if (mm[1] && /analyze/i.test(mm[1])) analyze = true;
      rest = rest.slice(mm[0].length);
    }
  }

  return { inner: rest, analyze };
}

/** A statement is read-only iff it (and every CTE body it contains) is. */
function isReadOnlyStatement(s: Statement): boolean {
  switch (s.type) {
    case 'select':
    case 'values':
      return true;
    case 'union':
    case 'union all':
      return isReadOnlyStatement(s.left) && isReadOnlyStatement(s.right);
    case 'with':
      return s.bind.every((b) => isReadOnlyStatement(b.statement)) && isReadOnlyStatement(s.in);
    default:
      // insert / update / delete / truncate table / drop table / create … / etc.
      return false;
  }
}

/** True if the outermost query carries a WHERE (used for broad-scan detection). */
function topLevelHasWhere(s: Statement): boolean {
  switch (s.type) {
    case 'select':
      return s.where != null;
    case 'with':
      return topLevelHasWhere(s.in);
    case 'union':
    case 'union all':
      return topLevelHasWhere(s.left) || topLevelHasWhere(s.right);
    default:
      return false;
  }
}

interface Collected {
  tables: Array<{ name: string; schema?: string }>;
  cteNames: Set<string>;
  calls: Set<string>;
  columns: Set<string>;
  star: boolean;
}

function collect(stmt: Statement): Collected {
  const tables: Array<{ name: string; schema?: string }> = [];
  const seen = new Set<string>();
  const cteNames = new Set<string>();
  const calls = new Set<string>();
  const columns = new Set<string>();
  let star = false;

  const visitor = astVisitor((map) => ({
    tableRef: (t) => {
      const key = `${t.schema ?? ''}.${t.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        tables.push(t.schema ? { name: t.name, schema: t.schema } : { name: t.name });
      }
      map.super().tableRef(t);
    },
    call: (c) => {
      const name = c.function?.name;
      if (name) calls.add(name.toLowerCase());
      map.super().call(c);
    },
    with: (w) => {
      for (const b of w.bind) {
        const alias = typeof b.alias === 'string' ? b.alias : b.alias?.name;
        if (alias) cteNames.add(alias);
      }
      map.super().with(w);
    },
    ref: (r) => {
      if (r.name === '*') star = true;
      else columns.add(r.name.toLowerCase());
      map.super().ref(r);
    },
  }));
  visitor.statement(stmt);

  return { tables, cteNames, calls, columns, star };
}

/**
 * Conservative sensitive-column flagging: a "table.column" entry is flagged when
 * its table is touched AND the query selects `*` or references that column name.
 * Over-flagging is safe (the Redactor masks; the gate only flags). Precise
 * alias→table resolution is deferred to the Redactor phase.
 */
function detectSensitive(
  sensitive: ReadonlySet<string>,
  touchedTables: ReadonlySet<string>,
  c: Collected,
): string[] {
  const out: string[] = [];
  for (const entry of sensitive) {
    // `touchedTables` holds BARE table names, so match the column (last segment)
    // against the bare table (second-to-last segment). This handles both
    // "table.column" and schema-qualified "schema.table.column" (Codex P1).
    const parts = entry.split('.');
    if (parts.length < 2) continue;
    const column = (parts[parts.length - 1] ?? '').toLowerCase();
    const table = parts[parts.length - 2] ?? '';
    if (!table || !touchedTables.has(table)) continue;
    if (c.star || c.columns.has(column)) out.push(entry);
  }
  return out;
}

export class SqlSafetyGate implements SafetyGate {
  check(sql: string, ctx: SafetyContext): SafetyDecision {
    // 0. EXPLAIN (not modelled by the parser): strip and validate the inner
    //    statement through the same AST rules. EXPLAIN ANALYZE executes → reject.
    const explain = stripExplain(sql);
    if (explain) {
      if (explain.analyze) {
        return reject(
          'not_read_only',
          'EXPLAIN ANALYZE executes the statement and is not permitted.',
        );
      }
      if (!explain.inner.trim()) {
        return reject('unparseable', 'EXPLAIN with no statement to analyze.');
      }
      return evaluate(explain.inner, ctx);
    }
    return evaluate(sql, ctx);
  }
}

/** Core AST validation of a single (non-EXPLAIN) statement. */
function evaluate(sql: string, ctx: SafetyContext): SafetyDecision {
  // 1. Parse.
  let ast: Statement[];
  try {
    ast = parse(sql);
  } catch {
    return reject('unparseable', 'The statement could not be parsed as SQL.');
  }

  // 2. Single statement.
  if (ast.length === 0) {
    return reject('unparseable', 'No SQL statement was found.');
  }
  if (ast.length > 1) {
    return reject('multiple_statements', 'Only a single statement may be executed.');
  }
  const stmt = ast[0]!;

  // 3. Read-only only (recurses into CTE bodies, union arms).
  if (!isReadOnlyStatement(stmt)) {
    return reject('not_read_only', 'Only read-only SELECT statements may be executed.');
  }

  const collected = collect(stmt);

  // 4. No admin / maintenance functions.
  for (const fn of collected.calls) {
    if (isDeniedFunction(fn)) {
      return reject('admin_or_maintenance', `The function "${fn}" is not permitted.`);
    }
  }

  // 5. Authorized tables (CTE names are not real relations).
  const touchedTables: string[] = [];
  for (const t of collected.tables) {
    if (collected.cteNames.has(t.name)) continue;
    const qualified = t.schema ? `${t.schema}.${t.name}` : t.name;
    if (!ctx.allowedTables.has(t.name) && !ctx.allowedTables.has(qualified)) {
      return reject(
        'unauthorized_table',
        `The table "${qualified}" is not authorized for this question.`,
      );
    }
    touchedTables.push(t.name);
  }
  const uniqueTables = [...new Set(touchedTables)];
  const tableSet = new Set(uniqueTables);

  // 6. Sensitive columns: flag (the Redactor masks).
  const touchedSensitive = detectSensitive(ctx.sensitiveColumns, tableSet, collected);

  // 8. Confirmation triggers (PRD default-strict Policy).
  const isLarge = (table: string): boolean => {
    const large = ctx.policy.largeTables;
    return large && large.size > 0 ? large.has(table) : true;
  };
  const broadScan = !topLevelHasWhere(stmt) && uniqueTables.some(isLarge);
  const needsConfirmation =
    (ctx.policy.confirmation.onSensitiveAccess && touchedSensitive.length > 0) ||
    (ctx.policy.confirmation.onBroadScan && broadScan);

  return {
    verdict: 'allow',
    touchedTables: uniqueTables,
    touchedSensitive,
    needsConfirmation,
  };
}

/** Construct the default M0 Safety Gate. */
export function createSafetyGate(): SafetyGate {
  return new SqlSafetyGate();
}
