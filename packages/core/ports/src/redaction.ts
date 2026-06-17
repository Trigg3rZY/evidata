/**
 * Redactor port (spec 01 §2.3, 03 §4).
 *
 * The single crossing point to the (externally-treated) AgentProvider: it turns
 * a raw `QueryRunResult` into a bounded, redacted result. Its output is the only
 * thing recorded as Evidence and the only thing fed back to the provider — raw
 * rows are never persisted nor sent to the model.
 */
import type { ColumnMeta, QueryRunResult } from './connector';

export interface RedactionContext {
  /** Hard cap on rows surfaced to the provider / Evidence sample. */
  rowLimit: number;
  /** Sensitive columns as "table.column"; values in matching output columns are masked. */
  sensitiveColumns: ReadonlySet<string>;
  /** Reserved for the M2 capability matrix; M0 runs as a single identity. */
  viewerRole?: string;
}

export interface RedactedResult {
  columns: ColumnMeta[];
  /** Capped, sensitive values masked. */
  sampleRows: ReadonlyArray<Record<string, unknown>>;
  /** Optional bounded summary preferred over full rows; unused in M0. */
  aggregateSummary?: Record<string, unknown>;
  /** True row count of the (already executor-bounded) result. */
  rowCount: number;
  /** Output column names whose values were masked. */
  redactedColumns: string[];
  truncated: boolean;
}

export interface Redactor {
  redact(result: QueryRunResult, ctx: RedactionContext): RedactedResult;
}
