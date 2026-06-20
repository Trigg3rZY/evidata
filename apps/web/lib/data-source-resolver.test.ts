import { describe, expect, it } from 'vitest';
import type {
  Connector,
  DataSourceConnectionRecord,
  DataSourceRecord,
  EntityMappingRecord,
  GlossaryStatus,
  GlossaryTermRecord,
  PolicyRecord,
  SchemaSnapshot,
} from '@evidata/ports';
import { PublishedDataSourceResolver } from './data-source-resolver';

const snapshot: SchemaSnapshot = {
  dataSourceId: 'ds-x',
  capturedAt: '2026-06-18T00:00:00.000Z',
  partial: false,
  tables: [{ name: 'accounts', columns: [] }],
};

const fakeConnector = {
  id: 'c1',
  kind: 'postgres',
  getSchemaSnapshot: () => Promise.resolve(snapshot),
  getExecutor: () => ({}) as never,
  close: () => Promise.resolve(),
} satisfies Connector;

const published: DataSourceRecord = {
  id: 'ds-x',
  name: 'Real PG',
  kind: 'postgres',
  connectionId: 'c1',
  description: null,
  lifecycle: 'published',
  createdAt: '2026-06-18T00:00:00.000Z',
};

const binding: DataSourceConnectionRecord = {
  id: 'dsc',
  dataSourceId: 'ds-x',
  connectionId: 'c1',
  alias: null,
  includedTables: ['accounts', 'invoices'],
  fieldRules: { sensitiveColumns: ['accounts.email'] },
  createdAt: '2026-06-18T00:00:00.000Z',
};

const policy: PolicyRecord = {
  dataSourceId: 'ds-x',
  rowLimit: 500,
  timeoutMs: 8000,
  statementTimeoutMs: 7000,
  confirmOnBroadScan: true,
  confirmOnSensitiveAccess: false,
  updatedAt: '2026-06-18T00:00:00.000Z',
};

const glossary: GlossaryTermRecord[] = [
  {
    id: 'g1',
    term: 'MRR',
    definition: 'monthly recurring revenue',
    status: 'verified',
    provenance: 'admin',
  },
  {
    id: 'g2',
    term: 'churn',
    definition: 'lost accounts',
    status: 'suggested',
    provenance: 'ai_draft',
  },
];
const mappings: EntityMappingRecord[] = [
  { id: 'm1', fromRef: 'acct', toRef: 'accounts', status: 'verified', provenance: 'admin' },
  { id: 'm2', fromRef: 'inv', toRef: 'invoices', status: 'suggested', provenance: 'ai_draft' },
];

/** A store double whose individual reads can be overridden per test. */
function makeStore(over: Partial<Record<string, unknown>> = {}) {
  return {
    getDataSource: (id: string) =>
      Promise.resolve(
        id === 'ds-x'
          ? published
          : id === 'ds-draft'
            ? { ...published, id, lifecycle: 'draft' }
            : null,
      ),
    listPublishedDataSources: () =>
      Promise.resolve([
        { id: 'ds-x', name: 'Real PG', kind: 'postgres' },
        { id: 'sample', name: 'Sample', kind: 'sample' },
      ]),
    getDataSourceConnection: () => Promise.resolve(binding),
    getDataSourceContext: () =>
      Promise.resolve({
        dataSourceId: 'ds-x',
        overview: 'Billing data.',
        payload: {},
        updatedAt: '',
      }),
    getPolicy: () => Promise.resolve(policy),
    getGlossaryTerms: (_id: string, status?: GlossaryStatus) =>
      Promise.resolve(status ? glossary.filter((g) => g.status === status) : glossary),
    getEntityMappings: (_id: string, status?: GlossaryStatus) =>
      Promise.resolve(status ? mappings.filter((m) => m.status === status) : mappings),
    getLatestSnapshot: () => Promise.resolve(snapshot),
    // 'member' owns the Data Source, 'q' is a querier; anyone else has no role.
    getDataSourceRole: (userId: string) =>
      Promise.resolve(userId === 'member' ? 'owner' : userId === 'q' ? 'querier' : null),
    ...over,
  };
}

const okConnections = { connectorFor: () => Promise.resolve(fakeConnector as Connector) };
const STATIC = new Set(['sample']);
const MEMBER = 'member';

describe('PublishedDataSourceResolver (M2-S2, spec 09 §2)', () => {
  it('assembles a runtime: scope→allowedTables, rules→sensitive, policy, verified-only context', async () => {
    const r = new PublishedDataSourceResolver(makeStore(), okConnections, STATIC);
    const rt = await r.resolve('ds-x', MEMBER);
    expect(rt).not.toBeNull();
    expect(rt!.id).toBe('ds-x');
    expect([...rt!.safetyContext.allowedTables].sort()).toEqual(['accounts', 'invoices']);
    expect([...rt!.safetyContext.sensitiveColumns]).toEqual(['accounts.email']);
    expect(rt!.safetyContext.policy.rowLimit).toBe(500);
    expect(rt!.safetyContext.policy.statementTimeoutMs).toBe(7000);
    expect(rt!.schema.tables[0]?.name).toBe('accounts');
    // VERIFIED-only context handed to the model (suggested items are excluded).
    expect(rt!.context.overview).toBe('Billing data.');
    expect(rt!.context.glossary).toEqual([
      { term: 'MRR', definition: 'monthly recurring revenue' },
    ]);
    expect(rt!.context.mappings).toEqual([{ from: 'acct', to: 'accounts' }]);
  });

  it('refuses non-published, static, and unknown sources', async () => {
    const r = new PublishedDataSourceResolver(makeStore(), okConnections, STATIC);
    expect(await r.resolve('ds-draft', MEMBER)).toBeNull(); // draft is not runnable
    expect(await r.resolve('sample', MEMBER)).toBeNull(); // owned by the static list
    expect(await r.resolve('ghost', MEMBER)).toBeNull(); // unknown
  });

  it('gates a real source on Data Source membership (incl. queriers — spec 09 §6)', async () => {
    const r = new PublishedDataSourceResolver(makeStore(), okConnections, STATIC);
    expect(await r.resolve('ds-x')).toBeNull(); // anonymous → withheld
    expect(await r.resolve('ds-x', 'stranger')).toBeNull(); // no role → withheld
    expect(await r.resolve('ds-x', MEMBER)).not.toBeNull(); // owner → allowed
    expect(await r.resolve('ds-x', 'q')).not.toBeNull(); // querier → allowed (the point)
  });

  it('is not runnable without a captured snapshot or a usable connector', async () => {
    const noSnap = new PublishedDataSourceResolver(
      makeStore({ getLatestSnapshot: () => Promise.resolve(null) }),
      okConnections,
      STATIC,
    );
    expect(await noSnap.resolve('ds-x', MEMBER)).toBeNull();

    const vaultDown = new PublishedDataSourceResolver(
      makeStore(),
      { connectorFor: () => Promise.reject(new Error('vault unconfigured')) },
      STATIC,
    );
    expect(await vaultDown.resolve('ds-x', MEMBER)).toBeNull(); // error → not runnable, not a crash
  });

  it('falls back to safe Policy defaults when none is authored', async () => {
    const r = new PublishedDataSourceResolver(
      makeStore({ getPolicy: () => Promise.resolve(null) }),
      okConnections,
      STATIC,
    );
    const rt = await r.resolve('ds-x', MEMBER);
    expect(rt!.safetyContext.policy.rowLimit).toBe(1000);
    expect(rt!.safetyContext.policy.confirmation.onSensitiveAccess).toBe(true);
  });

  it('list() returns the member’s published sources, excluding static; nothing for anon/non-member', async () => {
    const r = new PublishedDataSourceResolver(makeStore(), okConnections, STATIC);
    expect(await r.list(MEMBER)).toEqual([{ id: 'ds-x', name: 'Real PG' }]);
    expect(await r.list()).toEqual([]); // anonymous → no real sources
    expect(await r.list('stranger')).toEqual([]); // non-member → none
  });
});
