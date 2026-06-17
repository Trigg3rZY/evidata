/**
 * Result Redactor (spec 03 §4) — a single deterministic pass over a raw
 * `QueryRunResult` producing the bounded, redacted result that is the ONLY
 * thing recorded as Evidence and fed back to the provider.
 *
 * M0 masking is by output-column NAME: an output column is masked when its
 * (unqualified) name matches the column part of any sensitive "table.column".
 * This intentionally over-masks rather than under-masks — precise alias→table
 * resolution is a documented future refinement (spec 03 §4). Masking replaces
 * values in place (the column and row shape are preserved) so structural
 * context survives for both the viewer and the provider.
 */
import type {
  ColumnMeta,
  QueryRunResult,
  RedactedResult,
  RedactionContext,
  Redactor,
} from '@evidata/ports';

/** Replacement token for a masked value. */
export const MASK = '••••••';

/** Max rows surfaced as a provider/Evidence sample, regardless of rowLimit. */
export const SAMPLE_ROW_CAP = 50;

/** Column parts of the sensitive "table.column" set, lower-cased. */
function sensitiveColumnNames(sensitive: ReadonlySet<string>): Set<string> {
  const names = new Set<string>();
  for (const entry of sensitive) {
    const dot = entry.indexOf('.');
    const col = dot >= 0 ? entry.slice(dot + 1) : entry;
    if (col) names.add(col.toLowerCase());
  }
  return names;
}

export class ResultRedactor implements Redactor {
  redact(result: QueryRunResult, ctx: RedactionContext): RedactedResult {
    const sensitiveNames = sensitiveColumnNames(ctx.sensitiveColumns);
    const columns: ColumnMeta[] = result.columns.map((c) => ({ ...c }));
    const redactedColumns = columns
      .map((c) => c.name)
      .filter((name) => sensitiveNames.has(name.toLowerCase()));
    const redactedSet = new Set(redactedColumns);

    const cap = Math.max(0, Math.min(ctx.rowLimit, SAMPLE_ROW_CAP));
    const sliced = result.rows.slice(0, cap);
    const sampleRows = redactedSet.size
      ? sliced.map((row) => {
          const masked: Record<string, unknown> = { ...row };
          for (const col of redactedSet) {
            if (col in masked) masked[col] = MASK;
          }
          return masked;
        })
      : sliced.map((row) => ({ ...row }));

    return {
      columns,
      sampleRows,
      rowCount: result.rowCount,
      redactedColumns,
      truncated: result.truncated || sampleRows.length < result.rowCount,
    };
  }
}

/** Construct the default M0 Redactor. */
export function createRedactor(): Redactor {
  return new ResultRedactor();
}
