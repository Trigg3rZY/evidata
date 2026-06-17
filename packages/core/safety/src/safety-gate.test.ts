import { describe, expect, it } from 'vitest';
import type { Policy, SafetyContext, SafetyDecision } from '@evidata/ports';
import { createSafetyGate } from './safety-gate';

const gate = createSafetyGate();

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    rowLimit: 1000,
    timeoutMs: 5000,
    confirmation: { onBroadScan: true, onSensitiveAccess: true },
    largeTables: new Set(['invoices', 'usage']),
    ...overrides,
  };
}

function ctx(overrides: Partial<SafetyContext> = {}): SafetyContext {
  return {
    policy: policy(),
    allowedTables: new Set(['accounts', 'invoices', 'usage', 'public.usage']),
    sensitiveColumns: new Set(['accounts.contact_email']),
    ...overrides,
  };
}

function check(sql: string, c: SafetyContext = ctx()): SafetyDecision {
  return gate.check(sql, c);
}

/** Narrow to the reject reason, failing loudly if the gate allowed. */
function rejectReason(d: SafetyDecision): string {
  if (d.verdict !== 'reject') throw new Error(`expected reject, got allow: ${JSON.stringify(d)}`);
  return d.reason;
}

describe('SafetyGate — reject rules', () => {
  it('rejects unparseable input', () => {
    expect(rejectReason(check('NOT SQL AT ALL ;;;'))).toBe('unparseable');
  });

  it('rejects an empty statement', () => {
    expect(rejectReason(check('   '))).toBe('unparseable');
  });

  it('rejects multiple statements', () => {
    expect(rejectReason(check('SELECT 1; SELECT 2'))).toBe('multiple_statements');
  });

  it.each([
    ['INSERT', "INSERT INTO accounts(id) VALUES (1)"],
    ['UPDATE', "UPDATE accounts SET plan = 'pro' WHERE id = 1"],
    ['DELETE', 'DELETE FROM accounts WHERE id = 1'],
    ['TRUNCATE', 'TRUNCATE accounts'],
    ['DROP', 'DROP TABLE accounts'],
    ['CREATE', 'CREATE TABLE x (id int)'],
  ])('rejects non-read-only: %s', (_label, sql) => {
    expect(rejectReason(check(sql))).toBe('not_read_only');
  });

  it.each([
    ['DELETE in CTE', 'WITH x AS (DELETE FROM accounts RETURNING id) SELECT * FROM x'],
    ['INSERT in CTE', 'WITH x AS (INSERT INTO accounts(id) VALUES (1) RETURNING id) SELECT * FROM x'],
    ['UPDATE in CTE', "WITH x AS (UPDATE accounts SET plan = 'p' RETURNING id) SELECT * FROM x"],
  ])('rejects data-modifying CTE bodies: %s', (_label, sql) => {
    expect(rejectReason(check(sql))).toBe('not_read_only');
  });

  it('rejects a query touching an unauthorized table', () => {
    expect(rejectReason(check('SELECT * FROM secrets'))).toBe('unauthorized_table');
  });

  it('rejects an unauthorized table inside a join', () => {
    expect(rejectReason(check('SELECT * FROM accounts a JOIN secrets s ON a.id = s.id'))).toBe(
      'unauthorized_table',
    );
  });

  it.each([
    ['pg_read_file', "SELECT pg_read_file('/etc/passwd')"],
    ['lo_import', "SELECT lo_import('/etc/passwd')"],
    ['pg_sleep', 'SELECT pg_sleep(10)'],
    ['dblink (scalar)', "SELECT dblink('host=evil', 'SELECT 1')"],
  ])('rejects denylisted function: %s', (_label, sql) => {
    expect(rejectReason(check(sql))).toBe('admin_or_maintenance');
  });

  it('rejects admin/maintenance statements (parser-unmodelled) as fail-closed', () => {
    // SET ROLE / VACUUM / COPY, and dblink as a table-function with a column
    // definition list, are not modelled by the parser → unparseable (still
    // rejected). Fail-closed: the verdict is what matters, not the reason.
    expect(check('SET ROLE admin').verdict).toBe('reject');
    expect(check('VACUUM accounts').verdict).toBe('reject');
    expect(check("COPY accounts TO '/tmp/x.csv'").verdict).toBe('reject');
    expect(check("SELECT * FROM dblink('host=evil', 'SELECT 1') AS t(x int)").verdict).toBe('reject');
  });
});

describe('SafetyGate — allow + flags', () => {
  it('allows a filtered SELECT over an authorized table', () => {
    const d = check("SELECT id, amount FROM invoices WHERE month = '2026-05'");
    expect(d.verdict).toBe('allow');
    if (d.verdict === 'allow') {
      expect(d.touchedTables).toEqual(['invoices']);
      expect(d.touchedSensitive).toEqual([]);
      expect(d.needsConfirmation).toBe(false);
    }
  });

  it('allows a join across two authorized tables and reports both', () => {
    const d = check('SELECT * FROM usage u JOIN invoices i ON u.account_id = i.customer_id WHERE i.month = 1');
    expect(d.verdict).toBe('allow');
    if (d.verdict === 'allow') {
      expect(new Set(d.touchedTables)).toEqual(new Set(['usage', 'invoices']));
    }
  });

  it('treats CTE names as relations, not unauthorized tables', () => {
    const d = check('WITH t AS (SELECT * FROM invoices WHERE id = 1) SELECT * FROM t');
    expect(d.verdict).toBe('allow');
    if (d.verdict === 'allow') expect(d.touchedTables).toEqual(['invoices']);
  });

  it('allows a UNION over authorized tables', () => {
    const d = check('SELECT id FROM accounts WHERE id = 1 UNION SELECT customer_id FROM invoices WHERE id = 1');
    expect(d.verdict).toBe('allow');
  });

  it('resolves schema-qualified table names', () => {
    const d = check('SELECT * FROM public.usage WHERE account_id = 1');
    expect(d.verdict).toBe('allow');
  });

  it('flags a broad scan (no WHERE) of a large table', () => {
    const d = check('SELECT * FROM invoices');
    expect(d.verdict).toBe('allow');
    if (d.verdict === 'allow') expect(d.needsConfirmation).toBe(true);
  });

  it('does not flag an unfiltered scan of a small table', () => {
    const d = check('SELECT id FROM accounts'); // accounts is not in largeTables
    expect(d.verdict).toBe('allow');
    if (d.verdict === 'allow') expect(d.needsConfirmation).toBe(false);
  });

  it('flags sensitive-column access and requires confirmation', () => {
    const d = check('SELECT contact_email FROM accounts WHERE id = 1');
    expect(d.verdict).toBe('allow');
    if (d.verdict === 'allow') {
      expect(d.touchedSensitive).toEqual(['accounts.contact_email']);
      expect(d.needsConfirmation).toBe(true);
    }
  });

  it('flags sensitive columns reached via SELECT *', () => {
    const d = check('SELECT * FROM accounts WHERE id = 1');
    if (d.verdict === 'allow') expect(d.touchedSensitive).toEqual(['accounts.contact_email']);
  });

  it('honours a Policy that disables confirmation triggers', () => {
    const c = ctx({ policy: policy({ confirmation: { onBroadScan: false, onSensitiveAccess: false } }) });
    const d = check('SELECT * FROM invoices', c); // broad scan of large table
    if (d.verdict === 'allow') expect(d.needsConfirmation).toBe(false);
  });
});
