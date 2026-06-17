import { describe, expect, it } from 'vitest';
import type { QueryRunResult, RedactionContext } from '@evidata/ports';
import { createRedactor, MASK, SAMPLE_ROW_CAP } from './index';

const redactor = createRedactor();

const ctx = (over: Partial<RedactionContext> = {}): RedactionContext => ({
  rowLimit: 1000,
  sensitiveColumns: new Set(['accounts.contact_email']),
  ...over,
});

const result = (over: Partial<QueryRunResult> = {}): QueryRunResult => ({
  columns: [
    { name: 'id', dataType: 'integer' },
    { name: 'name', dataType: 'text' },
    { name: 'contact_email', dataType: 'text' },
  ],
  rows: [
    { id: 1, name: 'ACME', contact_email: 'ops@acme.example' },
    { id: 2, name: 'Globex', contact_email: 'billing@globex.example' },
  ],
  rowCount: 2,
  truncated: false,
  elapsedMs: 5,
  ...over,
});

describe('ResultRedactor (spec 03 §4)', () => {
  it('masks sensitive column values in place and leaves other columns intact', () => {
    const r = redactor.redact(result(), ctx());
    expect(r.sampleRows[0]).toEqual({ id: 1, name: 'ACME', contact_email: MASK });
    expect(r.sampleRows[1]).toEqual({ id: 2, name: 'Globex', contact_email: MASK });
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'name', 'contact_email']);
    expect(r.redactedColumns).toEqual(['contact_email']);
  });

  it('reports no redactions when no sensitive column is present', () => {
    const r = redactor.redact(
      result({
        columns: [
          { name: 'id', dataType: 'integer' },
          { name: 'total', dataType: 'numeric' },
        ],
        rows: [{ id: 1, total: 48200 }],
        rowCount: 1,
      }),
      ctx(),
    );
    expect(r.redactedColumns).toEqual([]);
    expect(r.sampleRows[0]).toEqual({ id: 1, total: 48200 });
  });

  it('flags a sensitive column even when there are zero rows', () => {
    const r = redactor.redact(result({ rows: [], rowCount: 0 }), ctx());
    expect(r.redactedColumns).toEqual(['contact_email']);
    expect(r.sampleRows).toEqual([]);
  });

  it('caps the sample to SAMPLE_ROW_CAP and marks truncation, preserving rowCount', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      name: `n${i}`,
      contact_email: `u${i}@x.example`,
    }));
    const r = redactor.redact(result({ rows: many, rowCount: 120 }), ctx());
    expect(r.sampleRows).toHaveLength(SAMPLE_ROW_CAP);
    expect(r.rowCount).toBe(120);
    expect(r.truncated).toBe(true);
    expect(r.sampleRows.every((row) => row.contact_email === MASK)).toBe(true);
  });

  it('respects a rowLimit smaller than the sample cap', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: i, name: 'n', contact_email: 'e' }));
    const r = redactor.redact(result({ rows: many, rowCount: 10 }), ctx({ rowLimit: 3 }));
    expect(r.sampleRows).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it('carries through executor truncation', () => {
    const r = redactor.redact(result({ truncated: true }), ctx());
    expect(r.truncated).toBe(true);
  });

  it('does not mutate the input rows (pure)', () => {
    const input = result();
    redactor.redact(input, ctx());
    expect(input.rows[0]).toEqual({ id: 1, name: 'ACME', contact_email: 'ops@acme.example' });
  });

  it('matches sensitivity by column name regardless of qualifying table', () => {
    const r = redactor.redact(result(), ctx({ sensitiveColumns: new Set(['contact_email']) }));
    expect(r.redactedColumns).toEqual(['contact_email']);
  });
});
