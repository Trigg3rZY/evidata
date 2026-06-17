/**
 * SQL Safety Gate port (spec 01 §2.2, spec 03 §3).
 *
 * The Gate is the deterministic trust boundary between the AgentProvider's
 * proposed SQL and any execution. It parses with `pgsql-ast-parser` and decides
 * on the AST — never on regex — and the provider cannot override a `reject`.
 */

/**
 * Execution / safety Policy (PRD default-strict). M0 uses the Sample's default
 * Policy. The executor reads `rowLimit`/`timeoutMs`; the Gate reads the
 * confirmation thresholds.
 */
export interface Policy {
  /** Hard row cap. The executor appends this as a LIMIT when none is present. */
  rowLimit: number;
  /** Per-statement execution timeout (application-enforced). */
  timeoutMs: number;
  /** Optional DB-level statement timeout (defense in depth). */
  statementTimeoutMs?: number;
  /** Confirmation triggers (PRD default-strict Policy). */
  confirmation: {
    /** Require confirmation for an unfiltered scan of a large table. */
    onBroadScan: boolean;
    /** Require confirmation when a sensitive column is touched. */
    onSensitiveAccess: boolean;
  };
  /**
   * Tables large enough that an unfiltered (no-WHERE) scan needs confirmation.
   * Empty/omitted ⇒ any unfiltered scan of an authorized table is "broad".
   */
  largeTables?: ReadonlySet<string>;
}

export interface SafetyContext {
  policy: Policy;
  /** Relations the question is authorized to read (bare or "schema.table"). */
  allowedTables: ReadonlySet<string>;
  /** Sensitive columns as "table.column". The Gate flags; the Redactor masks. */
  sensitiveColumns: ReadonlySet<string>;
}

export type SafetyRejectReason =
  | 'not_read_only' // INSERT/UPDATE/DELETE/MERGE/DDL/DCL/TRUNCATE/COPY
  | 'multiple_statements'
  | 'unauthorized_table'
  | 'admin_or_maintenance' // VACUUM, ANALYZE, SET ROLE, COPY, denylisted functions
  | 'unparseable';

export type SafetyDecision =
  | {
      verdict: 'allow';
      touchedTables: string[];
      touchedSensitive: string[];
      needsConfirmation: boolean;
    }
  | { verdict: 'reject'; reason: SafetyRejectReason; detail: string };

export interface SafetyGate {
  /** Deterministic, synchronous. Called before any execution. */
  check(sql: string, ctx: SafetyContext): SafetyDecision;
}
