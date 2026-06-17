/**
 * SampleConnector — the executable Sample Data Source (spec 05).
 *
 * Owns a freshly seeded pglite instance (its own database, separate from the
 * product MetadataStore) and exposes it behind the `Connector`/`QueryExecutor`
 * ports. Also ships the Sample's pre-Verified context, Policy, and the
 * authorization sets the SafetyGate needs (spec 05 §2.3) — M0 has no
 * calibration UI, so these are static.
 */
import { PGlite } from '@electric-sql/pglite';
import type { Connector, Policy, SafetyContext } from '@evidata/ports';
import { PgliteQueryExecutor } from './executor';
import { SAMPLE_SCHEMA_SNAPSHOT } from './schema';
import { seedSample } from './seed';

export const SAMPLE_DATA_SOURCE_ID = 'sample';

// --- Authorization & policy the SafetyGate consumes ------------------------

export const SAMPLE_ALLOWED_TABLES: ReadonlySet<string> = new Set([
  'accounts',
  'campaigns',
  'campaign_spend',
  'invoices',
]);

export const SAMPLE_SENSITIVE_COLUMNS: ReadonlySet<string> = new Set(['accounts.contact_email']);

/** Default-strict Sample Policy (spec 05 §2.3). */
export const SAMPLE_POLICY: Policy = {
  rowLimit: 1000,
  timeoutMs: 5000,
  statementTimeoutMs: 5000,
  confirmation: { onBroadScan: true, onSensitiveAccess: true },
  largeTables: new Set(['campaign_spend']),
};

/** Builds the SafetyContext for a question against the Sample. */
export function sampleSafetyContext(): SafetyContext {
  return {
    policy: SAMPLE_POLICY,
    allowedTables: SAMPLE_ALLOWED_TABLES,
    sensitiveColumns: SAMPLE_SENSITIVE_COLUMNS,
  };
}

// --- Pre-Verified Data Source Context (spec 05 §2.3) -----------------------

export interface SampleGlossaryTerm {
  term: string;
  definition: string;
  status: 'verified' | 'suggested';
}

export interface SampleEntityMapping {
  from: string;
  to: string;
  status: 'verified' | 'suggested';
}

export interface SampleDataSourceContext {
  overview: string;
  glossary: SampleGlossaryTerm[];
  mappings: SampleEntityMapping[];
}

export const SAMPLE_CONTEXT: SampleDataSourceContext = {
  overview:
    'A small advertising-platform business: accounts run campaigns that accrue daily spend, and are billed monthly via invoices. Good for spend trends, per-campaign breakdowns, and customer rankings; not a system of record for billing disputes.',
  glossary: [
    {
      term: 'spend',
      definition: "campaign_spend.amount excluding status = 'void'",
      status: 'verified',
    },
    { term: 'active account', definition: "accounts.status = 'active'", status: 'verified' },
    { term: 'settlement date', definition: 'invoices.settled_at', status: 'verified' },
  ],
  mappings: [
    { from: 'Customer', to: 'accounts.id', status: 'verified' },
    { from: 'Campaign', to: 'campaigns.id', status: 'verified' },
    // Intentionally NOT verified — drives the Unblock Path (spec 05 §4.3).
    { from: 'invoices.customer_ref', to: 'accounts.id', status: 'suggested' },
  ],
};

/**
 * The Sample's **Verified-only** context, in the shape the agent expects
 * (Suggested entries withheld — which is what makes the cross-area scenario
 * block). Structurally compatible with `@evidata/agent`'s `AgentContext`.
 */
export function sampleVerifiedContext(): {
  overview: string;
  glossary: Array<{ term: string; definition: string }>;
  mappings: Array<{ from: string; to: string }>;
} {
  return {
    overview: SAMPLE_CONTEXT.overview,
    glossary: SAMPLE_CONTEXT.glossary
      .filter((g) => g.status === 'verified')
      .map((g) => ({ term: g.term, definition: g.definition })),
    mappings: SAMPLE_CONTEXT.mappings
      .filter((m) => m.status === 'verified')
      .map((m) => ({ from: m.from, to: m.to })),
  };
}

// --- Connector factory -----------------------------------------------------

export interface SampleConnectorHandle {
  connector: Connector;
  client: PGlite;
  close: () => Promise<void>;
}

/** Creates a seeded Sample connector backed by an in-memory pglite instance. */
export async function createSampleConnector(): Promise<SampleConnectorHandle> {
  const client = new PGlite();
  await seedSample(client);
  const executor = new PgliteQueryExecutor(client);

  const connector: Connector = {
    id: SAMPLE_DATA_SOURCE_ID,
    kind: 'sample',
    getSchemaSnapshot: () => Promise.resolve(SAMPLE_SCHEMA_SNAPSHOT),
    getExecutor: () => executor,
  };

  return { connector, client, close: () => client.close() };
}
