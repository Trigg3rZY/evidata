# 08 — M1: Real PostgreSQL & Controlled Execution (architecture skeleton)

Goal (PRD): validate the safety/execution machinery on a real database. M1 swaps the Sample for a real PostgreSQL Connection behind the **same** `Connector`/`QueryExecutor` interface, and adds identity, connection management, schema introspection, credential encryption, and the real metadata store. The M0 controller (AgentRunner/SafetyGate/Redactor/EvidenceRecorder) is reused unchanged.

This is skeleton depth: components, interfaces, data model, and decisions — enough to plan, not line-level.

## 1. New components

| Component | Package | Responsibility |
|---|---|---|
| `PostgresConnector` | `packages/connectors/postgres` | Implements `Connector`/`QueryExecutor` against a real PG endpoint using a read-only role and `statement_timeout`. |
| `IntrospectionService` | `packages/core/introspection` | Reads `information_schema`/`pg_catalog` → `SchemaSnapshot` (tables, columns, types, FKs, indexes, comments, basic stats). App-side only; AI never connects. |
| `ConnectionService` | `packages/core/connection` | CRUD, test, enable/disable Connections; lists affected Data Sources before edit/disable. |
| `CredentialVault` | `packages/core/secrets` | App-level encryption of Connection credentials with a deployer-provided key; decrypt only at execution time. |
| `AuthService` + `first-run` | `packages/core/auth` | Local accounts, sessions; first completed setup user becomes initial Owner of the default Team. |
| `MetadataStore` (Postgres) | `packages/db` | The M0 pglite metadata store graduates to real Postgres via the same Drizzle schema + migrations. |

## 2. Connector parity (the key M1 property)

```ts
// M1 adds this; callers (AgentRunner, etc.) are unchanged.
export class PostgresConnector implements Connector {
  readonly kind = 'postgres';
  // Connects with a READ-ONLY role; sets statement_timeout per ExecOptions.
  getExecutor(): QueryExecutor { /* pg pool, read-only session */ }
  getSchemaSnapshot(): Promise<SchemaSnapshot> { /* via IntrospectionService */ }
}
```

The SafetyGate still runs first and still forbids non-SELECT; the read-only DB role is defense-in-depth, not the primary control. Each query still targets exactly one Connection.

## 3. Credential handling (PRD decision 4)

- Credentials are provided when creating a Connection and immediately encrypted by `CredentialVault` using `APP_ENCRYPTION_KEY` (deployer-provided env). Stored as an opaque blob on `Connection`.
- Decryption happens only inside `QueryExecutor` at execution time, in-process; plaintext never leaves the executor, never reaches the provider, never appears in Evidence or errors (PRD `Application States` — connection error text must not echo secrets).
- Roadmap: external secret managers behind the same `CredentialVault` interface.

## 4. New data model (migrations on top of M0)

`User`, `Session`, `Connection { id, kind, host, port, database, sslMode, credentialBlob, health, createdBy }`, `ConnectionMembership { userId, connectionId, role: 'owner'|'admin' }`, `SchemaSnapshot { connectionId, capturedAt, payload, partial }`.

`Investigation.dataSourceId` becomes a real reference; until M2 introduces Data Sources, M1 may use a minimal implicit Data Source wrapping one Connection (so the loop runs on real data before full calibration exists).

## 5. New API surface (sketch)

| Method & path | Purpose |
|---|---|
| `POST /api/setup` | First-run bootstrap; creates initial Owner + default Team. |
| `POST /api/auth/login` / `logout` | Local account session. |
| `POST /api/connections` / `GET` / `PATCH` / `DELETE` | Connection CRUD (Connection roles only). |
| `POST /api/connections/:id/test` | Connectivity + health. |
| `POST /api/connections/:id/introspect` | Produce/refresh a Schema Snapshot. |

All gated by `ConnectionMembership`; credentials never returned by `GET`.

## 6. Application states added (extends `03`/PRD Application States)

Connection: `Untested → Testing → Healthy / Auth failed / Unreachable / TLS error / Disabled`. Schema Snapshot: `Running → Complete / Partial / Failed`. These were specified in the PRD `Application States and Errors`; M1 implements them.

## 7. M1 decisions

- **Read-only role required.** Connections should use a least-privilege read-only DB role; the app documents this and surfaces a warning if the role can write. SafetyGate remains the primary guarantee.
- **Introspection scope.** Snapshot covers user schemas only (exclude system catalogs from the AI-visible snapshot); large schemas are summarized.
- **Metadata isolation.** Product metadata store is a separate database/credentials from any business Connection (PRD decision 5) — never co-located.
- **pglite retained.** The Sample Data Source keeps using pglite for demo/QA/smoke even after real PG exists.

## 8. M1 acceptance additions

- A real PostgreSQL Connection can be created, tested, introspected, and queried read-only end-to-end, producing an Answer with Evidence.
- Guardrails from M0 hold on real data (no writes executed; no credentials/PII to provider; every finding cites Evidence).
- Credential blob is encrypted at rest; no endpoint or error path leaks plaintext.
- First-run bootstrap creates the initial Owner; subsequent users require invitation (invitation UI may be minimal, full membership is M2).
