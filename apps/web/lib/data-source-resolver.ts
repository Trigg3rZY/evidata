/**
 * Resolves a *published* real Data Source into a runtime — the M2-S2 payoff
 * (spec 09 §2). It assembles, from the metadata store, the three things the
 * (unchanged) InvestigationService/AgentRunner needs:
 *   - connector:     a read-only PostgresConnector (creds decrypted via the vault),
 *   - safetyContext: allowedTables from the included scope, sensitiveColumns from
 *                    the field rules, plus the per-source Policy,
 *   - context:       VERIFIED-only overview / glossary / mappings for the model.
 * The built-in Sample remains a static runtime; this only handles dynamic sources.
 */
import type { AgentContext } from '@evidata/agent';
import type { ConnectionService } from '@evidata/connection';
import type { DataSourceResolver, DataSourceRuntime } from '@evidata/investigation';
import type {
  Connector,
  ConnectionHealth,
  DataSourceConnectionRecord,
  MetadataStore,
  PolicyRecord,
  SchemaColumn,
  SchemaSnapshot,
  SafetyContext,
} from '@evidata/ports';
import { canDataSource } from './authz';

/** Defaults when a published source has no explicit Policy row yet (spec 09 §5). */
const DEFAULT_POLICY = {
  rowLimit: 1000,
  timeoutMs: 30_000,
  confirmOnBroadScan: true,
  confirmOnSensitiveAccess: true,
} as const;

const UNAVAILABLE_HEALTH = new Set<ConnectionHealth>([
  'Unreachable',
  'AuthFailed',
  'TLSError',
  'Disabled',
]);

export class DataSourceConnectionUnavailableError extends Error {
  constructor(readonly health: ConnectionHealth) {
    super('Data Source connection is unavailable.');
    this.name = 'DataSourceConnectionUnavailableError';
  }
}

type ResolverStore = Pick<
  MetadataStore,
  | 'getDataSource'
  | 'getConnection'
  | 'listPublishedDataSources'
  | 'getDataSourceConnection'
  | 'getDataSourceContext'
  | 'getPolicy'
  | 'getGlossaryTerms'
  | 'getEntityMappings'
  | 'getLatestSnapshot'
  | 'getDataSourceRole'
>;

export class PublishedDataSourceResolver implements DataSourceResolver {
  constructor(
    private readonly store: ResolverStore,
    private readonly connections: Pick<ConnectionService, 'connectorFor'>,
    /** Ids already served by the service's static list (e.g. the Sample). */
    private readonly staticIds: ReadonlySet<string>,
  ) {}

  async list(userId?: string): Promise<Array<{ id: string; name: string }>> {
    if (!userId) return []; // real sources are never anonymous (the Sample is static)
    const published = await this.store.listPublishedDataSources();
    const out: Array<{ id: string; name: string }> = [];
    for (const d of published) {
      if (this.staticIds.has(d.id)) continue;
      if (await this.canQuery(d.id, userId)) out.push({ id: d.id, name: d.name });
    }
    return out;
  }

  async resolve(
    id: string,
    userId?: string,
    purpose: 'ask' | 'overview' = 'overview',
  ): Promise<DataSourceRuntime | null> {
    if (this.staticIds.has(id)) return null; // owned by the static list
    const ds = await this.store.getDataSource(id);
    if (!ds || ds.lifecycle !== 'published') return null;
    const binding = await this.store.getDataSourceConnection(id);
    if (!binding) return null;
    // Authz (spec 09 §6): the caller needs the `query` capability via their Data
    // Source role (owner/admin/querier) — NOT connection membership, so a querier
    // with no connection access can still ask. Anonymous → nothing. Returns null (not
    // an error) so an unauthorized id is indistinguishable from a missing one.
    if (!userId || !(await this.canQuery(id, userId))) return null;

    // Freshest captured schema, scoped to what the published source allows the
    // querier/model to see. Authoring reads the full snapshot separately.
    const schema = await this.store.getLatestSnapshot(binding.connectionId);
    if (!schema) return null;
    const connection = await this.store.getConnection(binding.connectionId);
    if (!connection) return null;
    if (UNAVAILABLE_HEALTH.has(connection.health)) {
      if (purpose !== 'ask') return null;
      throw new DataSourceConnectionUnavailableError(connection.health);
    }
    // Vault unconfigured / schema uncaptured → not runnable yet (clear product error upstream).
    const connector = await this.connectorOrNull(binding.connectionId);
    if (!connector) return null;

    const policy = await this.store.getPolicy(id);
    const ctx = await this.store.getDataSourceContext(id);
    const glossary = await this.store.getGlossaryTerms(id, 'verified');
    const mappings = await this.store.getEntityMappings(id, 'verified');

    return {
      id: ds.id,
      name: ds.name,
      connector,
      schema: scopeSchema(schema, binding.includedTables),
      safetyContext: buildSafetyContext(policy, binding),
      context: buildContext(ctx?.overview ?? '', glossary, mappings),
    };
  }

  /** True when `userId` has the `query` capability on this Data Source (spec 09 §6). */
  private async canQuery(dataSourceId: string, userId: string): Promise<boolean> {
    return canDataSource(await this.store.getDataSourceRole(userId, dataSourceId), 'query');
  }

  private async connectorOrNull(connectionId: string): Promise<Connector | null> {
    try {
      return await this.connections.connectorFor(connectionId);
    } catch {
      return null;
    }
  }
}

function scopeSchema(schema: SchemaSnapshot, includedTables: string[]): SchemaSnapshot {
  const included = new Set(includedTables);
  return {
    ...schema,
    tables: schema.tables
      .filter((t) => included.has(t.name))
      .map((t) => ({
        ...t,
        columns: t.columns.map((c) => scopeColumn(c, included)),
      })),
  };
}

function scopeColumn(column: SchemaColumn, included: ReadonlySet<string>): SchemaColumn {
  if (!column.references || included.has(column.references.table)) return column;
  const { references: _refs, ...rest } = column;
  return rest;
}

function buildSafetyContext(
  policy: PolicyRecord | null,
  binding: DataSourceConnectionRecord,
): SafetyContext {
  const p = policy ?? { ...DEFAULT_POLICY, statementTimeoutMs: null };
  return {
    policy: {
      rowLimit: p.rowLimit,
      timeoutMs: p.timeoutMs,
      ...(p.statementTimeoutMs != null ? { statementTimeoutMs: p.statementTimeoutMs } : {}),
      confirmation: {
        onBroadScan: p.confirmOnBroadScan,
        onSensitiveAccess: p.confirmOnSensitiveAccess,
      },
    },
    allowedTables: new Set(binding.includedTables),
    sensitiveColumns: new Set(binding.fieldRules.sensitiveColumns ?? []),
  };
}

function buildContext(
  overview: string,
  glossary: ReadonlyArray<{ term: string; definition: string }>,
  mappings: ReadonlyArray<{ fromRef: string; toRef: string }>,
): AgentContext {
  return {
    overview,
    glossary: glossary.map((g) => ({ term: g.term, definition: g.definition })),
    mappings: mappings.map((m) => ({ from: m.fromRef, to: m.toRef })),
  };
}
