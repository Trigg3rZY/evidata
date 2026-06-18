/**
 * Canned Sample scenarios (spec 05 §4) as FixtureProvider scripts. They are the
 * demo script and the deterministic smoke fixtures; a real provider should reach
 * equivalent outcomes. SQL targets the real seeded Sample so the loop executes
 * for real (the numbers come from the seed in @evidata/connector-sample).
 */
import type { KeyFinding } from './deps';
import { FixtureProvider } from './fixture-provider';
import type { AgentDecision } from './types';

/** Build a KeyFinding with a guaranteed-non-empty evidence citation. */
function kf(text: string, ...evidenceIds: [string, ...string[]]): KeyFinding {
  return { text, evidenceIds };
}

/** 4.1 happy path: multi-query, Answered/Medium with a cross-area caveat. */
export const ACME_BILL_UP: AgentDecision[] = [
  { kind: 'reasoning', label: 'Resolving the customer "ACME"' },
  {
    kind: 'query',
    proposal: {
      purpose: 'Compare ACME May vs June posted spend',
      sql: "select date_trunc('month', day) as month, sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted' and day >= '2026-05-01' and day < '2026-07-01' group by date_trunc('month', day) order by month",
    },
  },
  { kind: 'reasoning', label: 'Breaking the June total down by campaign' },
  {
    kind: 'query',
    proposal: {
      purpose: 'ACME June posted spend by campaign',
      sql: "select campaign_id, sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted' and day >= '2026-06-01' and day < '2026-07-01' group by campaign_id order by total desc",
    },
  },
  { kind: 'reasoning', label: 'Reconciling usage against billing' },
  {
    kind: 'query',
    proposal: {
      purpose: 'ACME invoices by month',
      sql: 'select period_month, amount, settled_at from invoices where account_id = 1 order by period_month',
    },
  },
  {
    kind: 'final',
    draft: {
      status: 'Answered',
      confidence: 'Medium',
      directAnswer:
        "ACME's June ad spend is 38% higher than May (48,200 vs 34,900) — almost entirely from the Summer Sale campaign.",
      confidenceReason:
        'Spend has a single source of truth; the usage⇄billing reconciliation is approximate because of invoice timing.',
      keyFindings: [
        kf('June posted spend was 48,200 vs 34,900 in May (+38.1%).', 'E1'),
        kf('The increase is concentrated in the Summer Sale campaign (+13,300).', 'E2'),
        kf('The June invoice (48,200) is not yet settled, so billing lags usage.', 'E3'),
      ],
      caveats: [
        'Usage⇄billing reconciliation is approximate — invoice timing can shift the totals.',
      ],
      recommendedFollowups: [
        { question: 'Break the June increase down by week.' },
        { question: 'Why is the June invoice not settled yet?' },
      ],
    },
  },
];

/** 4.5 guardrail: the provider proposes an UPDATE; the Safety Gate blocks it. */
export const MUTATION_ATTEMPT: AgentDecision[] = [
  { kind: 'reasoning', label: 'Attempting to correct a spend record' },
  {
    kind: 'query',
    proposal: {
      purpose: 'Void a duplicate spend row',
      sql: "update campaign_spend set status = 'void' where id = 1",
    },
  },
];

/** 4.3 Unblock Path: each area totals separately, but joining needs a Suggested mapping. */
export const CROSS_AREA_RECONCILE: AgentDecision[] = [
  { kind: 'reasoning', label: 'Totaling each area separately for ACME' },
  {
    kind: 'query',
    proposal: {
      purpose: 'ACME total posted spend (usage area)',
      sql: "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'",
    },
  },
  {
    kind: 'query',
    proposal: {
      purpose: 'ACME total invoiced (billing area)',
      sql: 'select sum(amount) as total from invoices where account_id = 1',
    },
  },
  { kind: 'reasoning', label: 'Joining usage↔billing needs an unverified mapping' },
  {
    kind: 'unblock',
    missing: [
      {
        kind: 'unverified_mapping',
        description: 'invoices.customer_ref → accounts.id is Suggested',
      },
    ],
  },
];

/** 4.4 NeedsClarification: a trend question with no time window. */
export const NEEDS_TIMERANGE: AgentDecision[] = [
  { kind: 'reasoning', label: 'No time window was given' },
  {
    kind: 'unblock',
    missing: [
      { kind: 'time_range', description: 'No time range was specified for the spend trend.' },
    ],
  },
];

/** Answered/High: a single clean aggregate ranks accounts by total posted spend. */
export const TOP_CUSTOMERS: AgentDecision[] = [
  { kind: 'reasoning', label: 'Ranking accounts by total posted spend' },
  {
    kind: 'query',
    proposal: {
      purpose: 'Total posted spend per account',
      sql: "select a.name, sum(s.amount) as total from campaign_spend s join accounts a on a.id = s.account_id where s.status = 'posted' group by a.name order by total desc",
    },
  },
  {
    kind: 'final',
    draft: {
      status: 'Answered',
      confidence: 'High',
      directAnswer:
        'The top customers by total posted ad spend are ACME Corp (83,100), Hooli (72,000), and Globex (56,000).',
      confidenceReason:
        'A single aggregate over all posted spend — no ambiguous definitions or unverified joins.',
      keyFindings: [
        kf('ACME Corp leads with 83,100 in total posted spend.', 'E1'),
        kf('Hooli (72,000) and Globex (56,000) follow.', 'E1'),
      ],
    },
  },
];

/** Redaction path: the query selects a sensitive column, so the Redactor masks it
 *  (•••) and the Answer carries a redaction caveat — the column is never shown. */
export const SENSITIVE_REDACTION: AgentDecision[] = [
  { kind: 'reasoning', label: 'Looking up the active accounts and their contacts' },
  {
    kind: 'query',
    proposal: {
      purpose: 'Active accounts and their contact emails',
      sql: "select name, contact_email from accounts where status = 'active' order by name",
    },
  },
  {
    kind: 'final',
    draft: {
      status: 'Answered',
      confidence: 'Medium',
      directAnswer:
        'There are five active accounts: ACME Corp, Globex, Hooli, Initech, and Umbrella. Their contact emails are a sensitive field and are not shown.',
      confidenceReason:
        'The account list is exact; the contact-email column is masked by Policy, so emails cannot be reported.',
      keyFindings: [kf('Five active accounts were found.', 'E1')],
      caveats: [
        'Contact emails are sensitive — masked by Policy (•••) and withheld from the answer and its evidence.',
      ],
    },
  },
];

export const SAMPLE_SCENARIOS: Readonly<Record<string, AgentDecision[]>> = {
  'acme-bill-up': ACME_BILL_UP,
  'mutation-attempt': MUTATION_ATTEMPT,
  'cross-area-reconcile': CROSS_AREA_RECONCILE,
  'needs-timerange': NEEDS_TIMERANGE,
  'top-customers': TOP_CUSTOMERS,
  'sensitive-redaction': SENSITIVE_REDACTION,
};

export function fixtureFor(scenarioId: string): FixtureProvider {
  return new FixtureProvider(SAMPLE_SCENARIOS[scenarioId] ?? []);
}
