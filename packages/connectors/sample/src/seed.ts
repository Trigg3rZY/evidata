/**
 * Deterministic seed for the Sample Data Source (spec 05 §2.2).
 *
 * The fixtures are chosen so smoke assertions are stable: ACME's posted spend
 * is 34900 in May and 48200 in June (+38.1%), with the June increase
 * concentrated in the `Summer Sale` campaign (Jun 1–9) and a couple of `void`
 * rows that must be excluded from "spend". Re-seeding is identical every run.
 */
import type { PGlite } from '@electric-sql/pglite';
import { SAMPLE_DDL } from './schema';

// --- Fixture totals (exported so tests assert against the spec, not magic numbers).
export const ACME_ACCOUNT_ID = 1;
export const ACME_MAY_SPEND = 34900;
export const ACME_JUNE_SPEND = 48200;
/** (48200 − 34900) / 34900 = 38.1%. */
export const ACME_MOM_PCT = 38.1;
export const ACME_SUMMER_SALE_JUNE = 13300; // the driver of the increase

interface SpendRow {
  id: number;
  accountId: number;
  campaignId: number;
  day: string; // YYYY-MM-DD
  amount: number;
  status: 'posted' | 'void';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Daily posted rows for one campaign in one month whose amounts sum EXACTLY to
 * `total` (integer cents avoided — amounts are whole units). The remainder is
 * placed on the first day.
 */
function dailyPosted(
  nextId: () => number,
  accountId: number,
  campaignId: number,
  year: number,
  month: number,
  fromDay: number,
  toDay: number,
  total: number,
): SpendRow[] {
  const days = toDay - fromDay + 1;
  const base = Math.floor(total / days);
  const remainder = total - base * days;
  const rows: SpendRow[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    const amount = base + (d === fromDay ? remainder : 0);
    rows.push({
      id: nextId(),
      accountId,
      campaignId,
      day: `${year}-${pad(month)}-${pad(d)}`,
      amount,
      status: 'posted',
    });
  }
  return rows;
}

interface SeedData {
  accounts: Array<
    [id: number, name: string, status: string, createdAt: string, email: string | null]
  >;
  campaigns: Array<[id: number, accountId: number, name: string, budget: number]>;
  spend: SpendRow[];
  invoices: Array<
    [
      id: number,
      accountId: number,
      period: string,
      amount: number,
      settledAt: string | null,
      ref: string,
    ]
  >;
}

function buildSeed(): SeedData {
  let spendId = 0;
  const nextId = (): number => (spendId += 1);

  const spend: SpendRow[] = [
    // ACME (1): two always-on campaigns flat across May+June; Summer Sale surges in June.
    ...dailyPosted(nextId, 1, 11, 2026, 5, 1, 31, 20000),
    ...dailyPosted(nextId, 1, 12, 2026, 5, 1, 31, 14900),
    ...dailyPosted(nextId, 1, 11, 2026, 6, 1, 30, 20000),
    ...dailyPosted(nextId, 1, 12, 2026, 6, 1, 30, 14900),
    ...dailyPosted(nextId, 1, 10, 2026, 6, 1, 9, ACME_SUMMER_SALE_JUNE),
    // Two void rows in June for ACME — excluded from "spend" (spec 05 glossary).
    { id: nextId(), accountId: 1, campaignId: 11, day: '2026-06-15', amount: 500, status: 'void' },
    { id: nextId(), accountId: 1, campaignId: 11, day: '2026-06-16', amount: 500, status: 'void' },
    // Other accounts: posted spend in June, distinct totals for the top-customers scenario.
    ...dailyPosted(nextId, 5, 50, 2026, 6, 1, 6, 72000), // Hooli
    ...dailyPosted(nextId, 2, 20, 2026, 6, 1, 7, 56000), // Globex
    ...dailyPosted(nextId, 4, 40, 2026, 6, 1, 5, 41000), // Umbrella
    ...dailyPosted(nextId, 3, 30, 2026, 6, 1, 4, 28000), // Initech
    // Stark (6) is churned — no recent spend.
  ];

  return {
    accounts: [
      [1, 'ACME Corp', 'active', '2025-01-15', 'ops@acme.example'],
      [2, 'Globex', 'active', '2025-03-02', 'billing@globex.example'],
      [3, 'Initech', 'active', '2025-06-20', 'ap@initech.example'],
      [4, 'Umbrella', 'active', '2025-09-10', 'finance@umbrella.example'],
      [5, 'Hooli', 'active', '2025-11-05', 'accounts@hooli.example'],
      [6, 'Stark Industries', 'churned', '2024-08-01', 'legacy@stark.example'],
    ],
    campaigns: [
      [10, 1, 'Summer Sale', 60000],
      [11, 1, 'Always-On Search', 30000],
      [12, 1, 'Always-On Display', 25000],
      [20, 2, 'Globex Brand', 40000],
      [30, 3, 'Initech Leads', 20000],
      [40, 4, 'Umbrella Awareness', 35000],
      [50, 5, 'Hooli Launch', 50000],
      [60, 6, 'Stark Legacy', 10000],
    ],
    spend,
    invoices: [
      // ACME billing lags usage: May invoice settled in June; June invoice unsettled.
      [1, 1, '2026-05-01', 34900, '2026-06-05', 'ACME-0001'],
      [2, 1, '2026-06-01', 48200, null, 'ACME-0001'],
      [3, 2, '2026-06-01', 56000, null, 'GLOBEX-22'],
      [4, 3, '2026-06-01', 28000, '2026-06-12', 'INI-3'],
      [5, 4, '2026-06-01', 41000, null, 'UMB-4'],
      [6, 5, '2026-06-01', 72000, '2026-06-15', 'HOOLI-5'],
    ],
  };
}

// --- SQL literal helpers (all inputs are controlled fixtures).
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const nullable = (s: string | null): string => (s === null ? 'NULL' : q(s));

function insertStatements(data: SeedData): string {
  const accounts = data.accounts
    .map(
      ([id, name, status, createdAt, email]) =>
        `(${id}, ${q(name)}, ${q(status)}, ${q(createdAt)}, ${nullable(email)})`,
    )
    .join(',\n');
  const campaigns = data.campaigns
    .map(([id, accountId, name, budget]) => `(${id}, ${accountId}, ${q(name)}, ${budget})`)
    .join(',\n');
  const spend = data.spend
    .map(
      (r) => `(${r.id}, ${r.accountId}, ${r.campaignId}, ${q(r.day)}, ${r.amount}, ${q(r.status)})`,
    )
    .join(',\n');
  const invoices = data.invoices
    .map(
      ([id, accountId, period, amount, settledAt, ref]) =>
        `(${id}, ${accountId}, ${q(period)}, ${amount}, ${nullable(settledAt)}, ${q(ref)})`,
    )
    .join(',\n');

  return [
    `INSERT INTO accounts (id, name, status, created_at, contact_email) VALUES\n${accounts};`,
    `INSERT INTO campaigns (id, account_id, name, budget) VALUES\n${campaigns};`,
    `INSERT INTO campaign_spend (id, account_id, campaign_id, day, amount, status) VALUES\n${spend};`,
    `INSERT INTO invoices (id, account_id, period_month, amount, settled_at, customer_ref) VALUES\n${invoices};`,
  ].join('\n');
}

/** Row counts produced by the seed, for determinism assertions. */
export const SEED_COUNTS = (() => {
  const d = buildSeed();
  return {
    accounts: d.accounts.length,
    campaigns: d.campaigns.length,
    campaign_spend: d.spend.length,
    invoices: d.invoices.length,
  };
})();

/** Creates the Sample schema and inserts the deterministic dataset. */
export async function seedSample(client: PGlite): Promise<void> {
  await client.exec(SAMPLE_DDL);
  await client.exec(insertStatements(buildSeed()));
}
