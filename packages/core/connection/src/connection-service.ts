/**
 * ConnectionService (spec 08 §6) — manages real database Connections behind the
 * MetadataStore + CredentialVault. Credentials are encrypted on create (AAD = the
 * connection id) and decrypted only transiently here, when probing (`test`) or
 * capturing the schema (`introspect`). API responses never carry the blob.
 *
 * Every method is authorized against the caller's ConnectionMembership; a caller
 * with no role can't even tell a connection exists (treated as not-found).
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  PostgresConnector,
  sslFor,
  type PostgresConnectionParams,
} from '@evidata/connector-postgres';
import { IntrospectionService } from '@evidata/introspection';
import type {
  Connector,
  ConnectionHealth,
  ConnectionRecord,
  ConnectionSummary,
  CredentialVault,
  MetadataStore,
} from '@evidata/ports';

/** Raised when the caller has no membership on the target connection. Routes → 404. */
export class ConnectionAccessError extends Error {
  constructor() {
    super('Connection not found.');
    this.name = 'ConnectionAccessError';
  }
}

/** Raised when an operation needs the credential vault but none is configured. */
export class VaultUnavailableError extends Error {
  constructor() {
    super('Credential encryption is not configured (set APP_ENCRYPTION_KEY).');
    this.name = 'VaultUnavailableError';
  }
}

/** Raised when a connection has no captured SchemaSnapshot yet (introspect first). */
export class SchemaUnavailableError extends Error {
  constructor() {
    super('Connection schema has not been captured yet (introspect the connection first).');
    this.name = 'SchemaUnavailableError';
  }
}

export type ConnectionStore = Pick<
  MetadataStore,
  | 'createConnection'
  | 'listConnections'
  | 'getConnection'
  | 'setConnectionHealth'
  | 'deleteConnection'
  | 'createConnectionMembership'
  | 'getConnectionRole'
  | 'saveSchemaSnapshot'
  | 'getLatestSnapshot'
  | 'createDataSource'
  | 'createDataSourceMembership'
  | 'listDataSourcesByConnection'
>;

export interface CreateConnectionInput {
  name: string;
  host: string;
  port: number;
  database: string;
  sslMode: string;
  /** The least-privilege read-only role (spec 08 §8). */
  user: string;
  password: string;
}

export interface ConnectionServiceDeps {
  store: ConnectionStore;
  /** Null when APP_ENCRYPTION_KEY is unset — create/test/introspect then error clearly. */
  vault: CredentialVault | null;
  introspection?: IntrospectionService;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

export interface IntrospectResult {
  tableCount: number;
  partial: boolean;
  capturedAt: string;
}

export class ConnectionService {
  private readonly introspection: IntrospectionService;
  private readonly newId: (prefix: string) => string;
  /** Live read-only connectors keyed by connection id; the pool is reused across turns. */
  private readonly connectors = new Map<string, PostgresConnector>();

  constructor(private readonly deps: ConnectionServiceDeps) {
    this.introspection = deps.introspection ?? new IntrospectionService();
    this.newId = deps.newId ?? ((p) => `${p}_${randomUUID()}`);
  }

  /**
   * Build (and cache) a read-only connector for a stored connection — the
   * server-side query path for a published Data Source (spec 09 §2). Decrypts the
   * credentials via the vault and binds the latest captured SchemaSnapshot; cached
   * by connection id so the pg pool is reused across turns. No per-user authz here:
   * the caller (the DataSource resolver) gates on the source's published state.
   */
  async connectorFor(connectionId: string): Promise<Connector> {
    const cached = this.connectors.get(connectionId);
    if (cached) return cached;
    const record = await this.deps.store.getConnection(connectionId);
    if (!record) throw new ConnectionAccessError();
    const snapshot = await this.deps.store.getLatestSnapshot(connectionId);
    if (!snapshot) throw new SchemaUnavailableError();
    const connector = new PostgresConnector(connectionId, this.paramsFor(record), snapshot);
    this.connectors.set(connectionId, connector);
    return connector;
  }

  /** Close all pooled connectors (graceful shutdown / connection mutation). */
  async closeAll(): Promise<void> {
    const all = [...this.connectors.values()];
    this.connectors.clear();
    await Promise.all(all.map((c) => c.close().catch(() => {})));
  }

  /** Evict + close the cached connector for one connection (on delete/mutate) so its
   *  pg pool doesn't outlive the connection. No-op if nothing is cached. */
  async evictConnector(connectionId: string): Promise<void> {
    const cached = this.connectors.get(connectionId);
    if (!cached) return;
    this.connectors.delete(connectionId);
    await cached.close().catch(() => {});
  }

  /** Create a Connection (encrypting its credentials), with the creator as owner
   *  and a minimal Data Source (M2 attaches context/policy to make it queryable). */
  async create(userId: string, input: CreateConnectionInput): Promise<ConnectionSummary> {
    const vault = this.requireVault();
    const id = this.newId('conn');
    // Encrypt the whole credential (role + password) under AAD = connection id.
    const credentialBlob = vault.encrypt(
      JSON.stringify({ user: input.user, password: input.password }),
      id,
    );
    const record = await this.deps.store.createConnection({
      id,
      kind: 'postgres',
      name: input.name,
      host: input.host,
      port: input.port,
      database: input.database,
      sslMode: input.sslMode,
      credentialBlob,
      health: 'Untested',
      createdBy: userId,
    });
    await this.deps.store.createConnectionMembership({
      id: this.newId('mem'),
      userId,
      connectionId: id,
      role: 'owner',
    });
    const dataSourceId = this.newId('ds');
    await this.deps.store.createDataSource({
      id: dataSourceId,
      name: input.name,
      kind: 'postgres',
      connectionId: id,
    });
    // Bootstrap the Data Source role matrix (M2-B1a): the creator owns the new source,
    // so authoring/query gates (now keyed on Data Source membership) admit them.
    await this.deps.store.createDataSourceMembership({
      id: this.newId('dsm'),
      userId,
      dataSourceId,
      role: 'owner',
    });
    return toSummary(record);
  }

  list(userId: string): Promise<ConnectionSummary[]> {
    return this.deps.store.listConnections(userId);
  }

  async get(userId: string, id: string): Promise<ConnectionSummary> {
    const record = await this.authorized(userId, id);
    return toSummary(record);
  }

  /** Delete a Connection, returning the Data Sources that were affected (08 §6). */
  async remove(
    userId: string,
    id: string,
  ): Promise<{ affectedDataSources: Array<{ id: string; name: string }> }> {
    await this.authorized(userId, id);
    const affectedDataSources = await this.deps.store.listDataSourcesByConnection(id);
    await this.deps.store.deleteConnection(id);
    // Drop any live pool for this connection so it doesn't leak past the delete.
    await this.evictConnector(id);
    return { affectedDataSources };
  }

  /** Probe connectivity + health; drives the Connection state machine (08 §7). */
  async test(userId: string, id: string): Promise<{ health: ConnectionHealth }> {
    const record = await this.authorized(userId, id);
    const health = await probe(this.paramsFor(record));
    await this.deps.store.setConnectionHealth(id, health);
    return { health };
  }

  /** Capture + store a fresh SchemaSnapshot (app-side; the AI never connects). */
  async introspect(userId: string, id: string): Promise<IntrospectResult> {
    const record = await this.authorized(userId, id);
    let snapshot;
    try {
      snapshot = await this.introspection.capture(this.paramsFor(record), id);
    } catch {
      await this.deps.store.saveSchemaSnapshot({
        id: this.newId('snap'),
        connectionId: id,
        status: 'failed',
        partial: false,
        payload: { dataSourceId: id, capturedAt: this.iso(), partial: false, tables: [] },
        capturedAt: this.now(),
      });
      throw new Error('Schema introspection failed.');
    }
    await this.deps.store.saveSchemaSnapshot({
      id: this.newId('snap'),
      connectionId: id,
      status: snapshot.partial ? 'partial' : 'complete',
      partial: snapshot.partial,
      payload: snapshot,
      capturedAt: this.now(),
    });
    return {
      tableCount: snapshot.tables.length,
      partial: snapshot.partial,
      capturedAt: snapshot.capturedAt,
    };
  }

  private async authorized(userId: string, id: string): Promise<ConnectionRecord> {
    const role = await this.deps.store.getConnectionRole(userId, id);
    const record = role ? await this.deps.store.getConnection(id) : null;
    if (!record) throw new ConnectionAccessError();
    return record;
  }

  private paramsFor(record: ConnectionRecord): PostgresConnectionParams {
    const vault = this.requireVault();
    const creds = JSON.parse(vault.decrypt(record.credentialBlob, record.id)) as {
      user: string;
      password: string;
    };
    return {
      host: record.host,
      port: record.port,
      database: record.database,
      user: creds.user,
      password: creds.password,
      ssl: sslFor(record.sslMode),
    };
  }

  private requireVault(): CredentialVault {
    if (!this.deps.vault) throw new VaultUnavailableError();
    return this.deps.vault;
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }
  private iso(): string {
    return this.now().toISOString();
  }
}

function toSummary(record: ConnectionRecord): ConnectionSummary {
  const { credentialBlob: _omit, ...summary } = record;
  return summary;
}

async function probe(params: PostgresConnectionParams): Promise<ConnectionHealth> {
  const client = new Client({
    host: params.host,
    port: params.port,
    database: params.database,
    user: params.user,
    password: params.password,
    ssl: params.ssl,
    connectionTimeoutMillis: 10000,
    application_name: 'evidata-test',
  });
  try {
    await client.connect();
  } catch (err) {
    return mapConnectError(err);
  }
  try {
    await client.query('SELECT 1');
    // A least-privilege read-only role shouldn't be able to write: neither create
    // objects (DB CREATE) nor INSERT/UPDATE/DELETE on any existing user table. If it
    // can, surface PermissionInsufficient (a warning, not a block) — spec 08 §7/§8.
    const r = await client.query<{ can_write: boolean }>(
      `SELECT (
         has_database_privilege(current_database(), 'CREATE')
         OR COALESCE((
           SELECT bool_or(
             has_table_privilege(c.oid, 'INSERT')
             OR has_table_privilege(c.oid, 'UPDATE')
             OR has_table_privilege(c.oid, 'DELETE')
           )
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r', 'p')
             AND n.nspname NOT IN ('pg_catalog', 'information_schema')
             AND left(n.nspname, 3) <> 'pg_'
         ), false)
       ) AS can_write`,
    );
    return r.rows[0]?.can_write ? 'PermissionInsufficient' : 'Healthy';
  } catch {
    return 'Unreachable';
  } finally {
    await client.end().catch(() => {});
  }
}

function mapConnectError(err: unknown): ConnectionHealth {
  const code = (err as { code?: string }).code;
  if (code === '28P01' || code === '28000') return 'AuthFailed';
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(code ?? '')) {
    return 'Unreachable';
  }
  if (/tls|ssl|certificate|self[- ]signed/i.test(err instanceof Error ? err.message : '')) {
    return 'TLSError';
  }
  return 'Unreachable';
}
