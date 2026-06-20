/**
 * Data Source authoring (M2-S3, spec 09 §5/§7) — the minimal create→attach→set
 * policy→publish flow behind the editable Data Sources detail page. A draft Data
 * Source already exists per Connection (created with the connection in M1); this
 * service edits it: table scope + sensitive columns, an overview, the safety
 * Policy, and the publish lifecycle. Owner-gated via the backing Connection's
 * membership (the same authz the query path uses). No AI calibration yet.
 */
import { randomUUID } from 'node:crypto';
import type {
  DataSourceLifecycle,
  DataSourceRecord,
  MetadataStore,
  SchemaSnapshot,
} from '@evidata/ports';

/** The caller isn't an owner/admin of the source's connection (route → 404). */
export class AuthoringAccessError extends Error {
  constructor() {
    super('Data source not found.');
    this.name = 'AuthoringAccessError';
  }
}

/** Resolve a Data Source and authorize the caller: they must have a role on its
 *  backing Connection (the same authz the query path uses). A non-owner — or a
 *  source with no backing connection (e.g. the Sample) — gets AuthoringAccessError
 *  (→ 404, no existence leak). Shared by authoring + calibration so the gate can't
 *  drift. */
export async function authorizeDataSourceAccess(
  store: Pick<MetadataStore, 'getDataSource' | 'getConnectionRole'>,
  userId: string,
  dataSourceId: string,
): Promise<{ ds: DataSourceRecord; connectionId: string }> {
  const ds = await store.getDataSource(dataSourceId);
  if (!ds || !ds.connectionId) throw new AuthoringAccessError();
  const role = await store.getConnectionRole(userId, ds.connectionId);
  if (!role) throw new AuthoringAccessError();
  return { ds, connectionId: ds.connectionId };
}

/** Publish blocked because the draft isn't ready (route → 409). */
export class PublishReadinessError extends Error {
  constructor(readonly missing: string[]) {
    super(`Not ready to publish: ${missing.join(', ')}.`);
    this.name = 'PublishReadinessError';
  }
}

/** Invalid authoring input, e.g. scoping to a non-existent table (route → 400). */
export class AuthoringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthoringValidationError';
  }
}

/** Defaults for a never-configured Policy (spec 09 §5) — strict by default. */
const DEFAULT_POLICY: PolicyForm = {
  rowLimit: 1000,
  timeoutMs: 30_000,
  statementTimeoutMs: null,
  confirmOnBroadScan: true,
  confirmOnSensitiveAccess: true,
};

export interface PolicyForm {
  rowLimit: number;
  timeoutMs: number;
  statementTimeoutMs: number | null;
  confirmOnBroadScan: boolean;
  confirmOnSensitiveAccess: boolean;
}

export interface AuthoringDraft {
  includedTables: string[];
  /** "table.column" (or "schema.table.column") sensitive columns. */
  sensitiveColumns: string[];
  overview: string;
  policy: PolicyForm;
}

export interface EditableDataSource extends AuthoringDraft {
  id: string;
  name: string;
  description: string | null;
  lifecycle: DataSourceLifecycle;
  /** The captured schema to scope against (null if never introspected). */
  schema: SchemaSnapshot | null;
  /** Publish-readiness preview so the UI can gate the button + explain gaps. */
  readiness: { ready: boolean; missing: string[] };
}

type AuthoringStore = Pick<
  MetadataStore,
  | 'getDataSource'
  | 'getConnectionRole'
  | 'getLatestSnapshot'
  | 'getDataSourceConnection'
  | 'getDataSourceContext'
  | 'getPolicy'
  | 'upsertDataSourceConnection'
  | 'upsertDataSourceContext'
  | 'upsertPolicy'
  | 'setDataSourceLifecycle'
  | 'listConnections'
  | 'listDataSourcesByConnection'
>;

/** A source the user may author — incl. drafts — for the Data Sources view rail. */
export interface AuthorableDataSource {
  id: string;
  name: string;
  lifecycle: DataSourceLifecycle;
}

export class DataSourceAuthoringService {
  constructor(
    private readonly store: AuthoringStore,
    private readonly newId: (prefix: string) => string = (p) => `${p}_${randomUUID()}`,
  ) {}

  /** The sources this user may author (every data source on a connection they're a
   *  member of) — including drafts, so the Data Sources view can list + open them. */
  async listAuthorable(userId: string): Promise<AuthorableDataSource[]> {
    const connections = await this.store.listConnections(userId);
    const out: AuthorableDataSource[] = [];
    for (const c of connections) {
      for (const d of await this.store.listDataSourcesByConnection(c.id)) {
        const full = await this.store.getDataSource(d.id);
        out.push({ id: d.id, name: d.name, lifecycle: full?.lifecycle ?? 'draft' });
      }
    }
    return out;
  }

  /** The editable state for the detail page (owner-only). */
  async getEditable(userId: string, dataSourceId: string): Promise<EditableDataSource> {
    const { ds, connectionId } = await this.authorize(userId, dataSourceId);
    const schema = await this.store.getLatestSnapshot(connectionId);
    const binding = await this.store.getDataSourceConnection(dataSourceId);
    const ctx = await this.store.getDataSourceContext(dataSourceId);
    const policy = await this.store.getPolicy(dataSourceId);

    const draft: AuthoringDraft = {
      includedTables: binding?.includedTables ?? [],
      sensitiveColumns: binding?.fieldRules.sensitiveColumns ?? [],
      overview: ctx?.overview ?? '',
      policy: policy
        ? {
            rowLimit: policy.rowLimit,
            timeoutMs: policy.timeoutMs,
            statementTimeoutMs: policy.statementTimeoutMs,
            confirmOnBroadScan: policy.confirmOnBroadScan,
            confirmOnSensitiveAccess: policy.confirmOnSensitiveAccess,
          }
        : { ...DEFAULT_POLICY },
    };

    return {
      id: ds.id,
      name: ds.name,
      description: ds.description,
      lifecycle: ds.lifecycle,
      schema,
      ...draft,
      readiness: readiness(schema, draft, policy !== null),
    };
  }

  /** Save the draft (binding + context + policy). Validates the scope against the
   *  captured schema so a source can't be scoped to tables that don't exist. If the
   *  source is already published and this edit makes it not-ready (e.g. the last
   *  included table is removed), it's pulled back to draft so it's never offered
   *  while unqueryable (Codex P2). */
  async save(userId: string, dataSourceId: string, draft: AuthoringDraft): Promise<void> {
    const { ds, connectionId } = await this.authorize(userId, dataSourceId);
    const schema = await this.store.getLatestSnapshot(connectionId);
    const known = new Set((schema?.tables ?? []).map((t) => t.name));
    const included = [...new Set(draft.includedTables)];
    const unknown = included.filter((t) => !known.has(t));
    if (unknown.length) {
      throw new AuthoringValidationError(
        `Unknown table(s) for this connection: ${unknown.join(', ')}.`,
      );
    }

    await this.store.upsertDataSourceConnection({
      id: this.newId('dsc'),
      dataSourceId,
      connectionId,
      alias: null,
      includedTables: included,
      fieldRules: { sensitiveColumns: [...new Set(draft.sensitiveColumns)] },
    });
    await this.store.upsertDataSourceContext({
      id: this.newId('ctx'),
      dataSourceId,
      overview: draft.overview,
      payload: {},
    });
    await this.store.upsertPolicy({
      id: this.newId('pol'),
      dataSourceId,
      rowLimit: draft.policy.rowLimit,
      timeoutMs: draft.policy.timeoutMs,
      statementTimeoutMs: draft.policy.statementTimeoutMs,
      confirmOnBroadScan: draft.policy.confirmOnBroadScan,
      confirmOnSensitiveAccess: draft.policy.confirmOnSensitiveAccess,
    });

    // Invariant: a published source is always ready/queryable. If this edit broke
    // that, demote to draft so the picker + resolver stop offering it.
    if (ds.lifecycle === 'published' && !(await this.checkReadiness(dataSourceId)).ready) {
      await this.store.setDataSourceLifecycle(dataSourceId, 'draft');
    }
  }

  /** Publish a draft once it passes the readiness checklist (spec 09 §7). */
  async publish(userId: string, dataSourceId: string): Promise<void> {
    await this.authorize(userId, dataSourceId);
    const { missing, ready } = await this.checkReadiness(dataSourceId);
    if (!ready) throw new PublishReadinessError(missing);
    await this.store.setDataSourceLifecycle(dataSourceId, 'published');
  }

  /** Pull a published source back to draft (it stops being queryable). */
  async unpublish(userId: string, dataSourceId: string): Promise<void> {
    await this.authorize(userId, dataSourceId);
    await this.store.setDataSourceLifecycle(dataSourceId, 'draft');
  }

  /** Resolve + authorize: the caller must have a role on the backing connection. */
  private authorize(
    userId: string,
    dataSourceId: string,
  ): Promise<{ ds: DataSourceRecord; connectionId: string }> {
    return authorizeDataSourceAccess(this.store, userId, dataSourceId);
  }

  private async checkReadiness(
    dataSourceId: string,
  ): Promise<{ ready: boolean; missing: string[] }> {
    const ds = await this.store.getDataSource(dataSourceId);
    const connectionId = ds?.connectionId ?? '';
    const schema = await this.store.getLatestSnapshot(connectionId);
    const binding = await this.store.getDataSourceConnection(dataSourceId);
    const policy = await this.store.getPolicy(dataSourceId);
    const draft: AuthoringDraft = {
      includedTables: binding?.includedTables ?? [],
      sensitiveColumns: binding?.fieldRules.sensitiveColumns ?? [],
      overview: '',
      policy: { ...DEFAULT_POLICY },
    };
    return readiness(schema, draft, policy !== null);
  }
}

/** Publish-readiness checklist (spec 09 §7): a captured schema, ≥1 included table,
 *  and a configured Policy. Returns the human-readable gaps for the UI. */
function readiness(
  schema: SchemaSnapshot | null,
  draft: AuthoringDraft,
  hasPolicy: boolean,
): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!schema || schema.tables.length === 0) missing.push('a captured schema');
  if (draft.includedTables.length === 0) missing.push('at least one included table');
  if (!hasPolicy) missing.push('a configured policy');
  return { ready: missing.length === 0, missing };
}
