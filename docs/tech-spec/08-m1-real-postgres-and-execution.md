# 08 — M1: Real PostgreSQL & Controlled Execution

Goal (PRD): validate the safety/execution machinery on a **real** database. M1 swaps the Sample for a real PostgreSQL Connection behind the **same** `Connector`/`QueryExecutor` ports, and adds identity, connection management, credential encryption, schema introspection, query cancellation, and the metadata store on real Postgres. The M0 controller — `AgentRunner` / `SafetyGate` / `Redactor` / evidence+QueryRun recording / `MetadataStore` / Answer Contract — is reused **unchanged**; M1 only adds adapters behind the ports (`01 §2`).

Implementation depth (the M0 milestone bar): components, port signatures, the real execution path, the credential scheme, the data model (`12`), API shapes, and decisions — enough to build.

PRD references: `Real Connections`, `AI Execution Boundary`, `Credential handling` (decision 4), `Metadata isolation` (decision 5), `Schema Snapshot`, `First-run & Accounts`, `Application States and Errors`.

## 1. New components

| Component | Package | Responsibility |
|---|---|---|
| `PostgresConnector` | `packages/connectors/postgres` | Implements `Connector`/`QueryExecutor` against a real PG endpoint over a read-only, time-bounded, cancellable session. |
| `CredentialVault` | `packages/core/secrets` | Authenticated encryption of Connection credentials with a deployer key; decrypt only at execution time. |
| `IntrospectionService` | `packages/core/introspection` | Reads `information_schema`/`pg_catalog` → `SchemaSnapshot` (tables, columns, types, FKs, indexes, comments, row estimates). App-side only; the AI never connects. |
| `ConnectionService` | `packages/core/connection` | CRUD / test / enable-disable Connections; lists affected Data Sources before an edit/disable. |
| `AuthService` + first-run | `packages/core/auth` | Local accounts, password hashing, server-side sessions; first completed setup becomes the initial Owner. |
| `MetadataStore` (Postgres) | `packages/db` | The M0 pglite store graduates to real Postgres via the **same** Drizzle schema; migrations run at deploy time (§9, `12`). |

Everything new sits behind a port, so `AgentRunner` and the rest of `packages/core` do not change.

## 2. Connector parity & the real execution path

`PostgresConnector` implements the existing `Connector` (`01 §2.1`); callers are unchanged.

```ts
export class PostgresConnector implements Connector {
  readonly kind = 'postgres';
  constructor(
    private readonly connection: ConnectionRecord, // host/port/db/sslMode + encrypted creds
    private readonly vault: CredentialVault,
    private readonly pool: PgPool,                  // one pooled, lazily-created per Connection
  ) {}
  readonly id = this.connection.id;
  getExecutor(): QueryExecutor { return new PostgresExecutor(this.pool, this.vault, this.connection); }
  getSchemaSnapshot(): Promise<SchemaSnapshot> { /* served from the stored snapshot; refresh via IntrospectionService */ }
}
```

`PostgresExecutor.run(sql, opts)` is the only place plaintext credentials and real rows exist, and it is **not** the safety boundary — the `SafetyGate` runs first and still forbids non-SELECT. The executor's job is bounded, read-only, cancellable execution:

1. **Read-only session, defense-in-depth.** Connect with a least-privilege **read-only DB role** (the documented requirement), and additionally wrap each statement in a `BEGIN TRANSACTION READ ONLY … COMMIT` with `SET LOCAL statement_timeout` and `SET LOCAL idle_in_transaction_session_timeout`. The role is the floor; the read-only transaction is a second floor; the `SafetyGate` is the primary control.
2. **Bounds pushed to the server (not sliced in JS).** Use a server-side cursor (`pg-cursor`) and read at most `rowLimit + 1` rows, then close the cursor — bounded memory regardless of result size, with `truncated = rowsRead > rowLimit`. (M0's pglite executor sliced in JS because the Sample is tiny; M1 must not pull large results into memory — `10 §3` already forbids persisting raw rows.)
3. **Cancellation.** `ExecOptions` gains an `AbortSignal` (§3.1); on abort the executor cancels the in-flight statement (Postgres `pg_cancel_backend` on the session's backend PID via a side connection) and closes the cursor.
4. **No credential/PII leakage on the error path.** Connection/auth/TLS failures map to product-level states (`§7`); raw driver errors (which can echo host or DSN fragments) are caught and replaced — never surfaced to the client, the provider, Evidence, or logs at info level (PRD `Application States`).

`QueryRunResult` and the redaction/recording flow are unchanged from M0 — the `Redactor` still produces the only thing that reaches the provider or persistence.

### 2.1 AbortSignal through the loop (resolves the M0 follow-up)

M0 deferred server-side cancellation (`04 §1.1`). M1 needs it (real queries can be slow), so the contract gains a signal that threads end to end:

```ts
export interface ExecOptions { rowLimit: number; timeoutMs: number; statementTimeoutMs?: number; signal?: AbortSignal; }
export interface AgentProvider { next(input: AgentInput, history: AgentHistory, signal?: AbortSignal): Promise<AgentDecision>; }
// AgentRunner.run(input, { ..., signal }) forwards it to provider.next and executor.run.
```

The SSE route (`04 §1`) creates an `AbortController`, aborts it in the stream's `cancel()` (client disconnect), and passes `signal` into the runner — which stops calling the provider and cancels any in-flight statement. The stream is already disconnect-safe; this also stops the *work*.

## 3. Credential handling (PRD decision 4)

Credentials are the highest-value secret in the system. The scheme is authenticated, key-rotatable, and provider-agnostic.

```ts
export interface EncryptedSecret { v: number; keyId: string; iv: string; ciphertext: string; authTag: string; } // all base64
export interface CredentialVault {
  encrypt(plaintext: string, aad: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret, aad: string): string;
}
```

- **Algorithm: AES-256-GCM** (authenticated; detects tampering) via Node `crypto`. A fresh 96-bit random IV per encryption; the 128-bit auth tag is stored alongside. **AAD = the Connection id**, binding ciphertext to its row so a blob cannot be swapped between Connections.
- **Key**: 32 bytes from `APP_ENCRYPTION_KEY` (base64 env, deployer-provided). `keyId`/`v` allow **rotation**: a new key is added, new writes use it, and a background re-encrypt migrates old blobs; decryption selects the key by `keyId`.
- **Lifecycle**: credentials are encrypted on Connection create/update and stored as the opaque `credentialBlob`; decryption happens **only inside `PostgresExecutor`** at execution time, in-process. Plaintext never leaves the executor, never reaches the provider, never appears in Evidence, API responses (`GET` never returns credentials), errors, or logs.
- **Default impl** `EnvKeyCredentialVault`; the port lets a roadmap KMS/secret-manager adapter (AWS KMS, Vault) drop in unchanged.

## 4. Schema introspection → `SchemaSnapshot`

`IntrospectionService.capture(connectionId): Promise<SchemaSnapshot>` connects **app-side** (the AI never connects) with the read-only role and reads structural metadata only:

- tables/columns/types/nullability/defaults from `information_schema`;
- primary & foreign keys from `pg_catalog` (`pg_constraint`), indexes from `pg_index`, comments via `obj_description`/`col_description`, row estimates from `pg_class.reltuples`.
- **Scope**: user schemas only — `pg_catalog`, `information_schema`, and other system schemas are excluded from the AI-visible snapshot.
- **Large schemas**: capped and summarized; the snapshot records `partial: true` and which objects were omitted (no silent truncation).

The result extends the M0 `SchemaSnapshot` (`01 §2.1`) with optional `indexes`, `rowEstimate`, and `comment` fields (additive; M0's Sample snapshot stays valid). It is stored (versioned per Connection, `12`) and served to the agent as `AgentInput.schema`; introspection is explicit (an action), never implicit per query.

## 5. Identity, sessions & first-run

Self-hosted, single-tenant; simple and revocable beats clever.

- **Passwords**: hashed with **Argon2id** (memory-hard); a `node:crypto scrypt` fallback is acceptable to avoid a native dependency. Never stored or logged in plaintext.
- **Sessions**: opaque 256-bit random token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie; only its SHA-256 hash is stored (`Session` table) so a DB read can't impersonate; sliding expiry + rotation on privilege change; logout deletes the row. (Server-side sessions, not JWTs — trivially revocable, fits self-hosting.)
- **First-run**: `POST /api/setup` is accepted **only while no `User` exists**; it creates the first **Owner** + the default Team, then is permanently disabled. Subsequent users join by invitation (minimal in M1; the full `Roles and Capability Matrix` is M2, `09`).
- **AuthService** resolves the session cookie → current `User`; route handlers gate on it. M1 enforces **Connection roles** (owner/admin) on Connection endpoints; the full matrix is M2.

## 6. New API surface

All JSON; all (except setup/login) require an authenticated session and the relevant capability. Credentials are **never** returned.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/setup` / `POST /api/setup` | First-run status; bootstrap initial Owner + Team. | 410 once a user exists. |
| `POST /api/auth/login` / `POST /api/auth/logout` | Local account session (sets/clears the cookie). | Rate-limited; generic failure message. |
| `GET /api/connections` / `POST` | List / create Connections. | `POST` body carries plaintext creds once, over TLS; response omits them. |
| `GET/PATCH/DELETE /api/connections/:id` | Read / edit / remove. | `PATCH`/`DELETE` list affected Data Sources first. |
| `POST /api/connections/:id/test` | Connectivity + health probe. | Drives the Connection state machine (§7). |
| `POST /api/connections/:id/introspect` | Produce/refresh a `SchemaSnapshot`. | Async-ish; drives the snapshot state machine. |

The M0 investigation routes (`04 §1`) are unchanged in shape but now require auth and resolve a real Connection-backed Data Source (the minimal implicit one until M2, `12`).

## 7. Application states (extends `03` / PRD `Application States`)

- **Connection**: `Untested → Testing → Healthy | AuthFailed | Unreachable | TLSError | PermissionInsufficient | Disabled`. `PermissionInsufficient` surfaces the read-only-role warning (§8) without blocking.
- **Schema Snapshot**: `Running → Complete | Partial | Failed`.

State transitions and their user-facing copy are product-level; raw driver errors never appear (§2.4).

## 8. Trust boundary across M1 (extends `01 §4`, `07 §4`)

The boundary's position is unchanged — AI proposes; the app validates/executes/redacts/records. M1 makes it real:

- **Credentials**: encrypted at rest (AES-256-GCM, §3), in transit (TLS to the DB per `sslMode`), decrypted only in the executor, never copied to Data Sources (M2) and never sent to the provider.
- **Read-only role required**: Connections must use a least-privilege read-only role; `test` warns (`PermissionInsufficient`) if the role can write. The `SafetyGate` remains the **primary** guarantee; the role and the `READ ONLY` transaction are defense-in-depth.
- **Metadata isolation** (decision 5): the product metadata store is a **separate database with separate credentials** from any business Connection — never co-located.

## 9. Metadata store on real Postgres

The M0 store graduates with the **same Drizzle schema and ports** (`10`, `12`):

- **Driver**: the `DrizzleMetadataStore` adapter (`10 §5`) is reused; only the client changes (pglite → `node-postgres`/`postgres-js` against `METADATA_DATABASE_URL`).
- **Migrations run at deploy time, not in the request path.** M0's embedded client exec'd an inlined `SCHEMA_SQL` because the migrator's `new URL('../drizzle', import.meta.url)` is not bundleable (`10 §7`). M1 sidesteps this entirely: a `db:migrate` script (plain Node, unbundled) applies the committed `drizzle/*.sql` via the file-based migrator against the real database before the app serves traffic. The runtime app only connects.
- The pglite Sample path is retained for demo/QA/smoke (it still uses the inlined DDL).

## 10. M1 decisions

- **Read-only role required**, with a write-capability warning on `test`; SafetyGate stays primary.
- **Cursor-bounded execution** (read `rowLimit+1`, server-side) — never pull whole results into memory.
- **AbortSignal threaded** through `AgentProvider`/`AgentRunner`/`QueryExecutor`; the SSE route cancels work on disconnect.
- **AES-256-GCM credential encryption** with AAD = connection id and `keyId`-based rotation; vault interface is KMS-ready.
- **Argon2id** password hashing; **server-side opaque sessions** (hashed at rest), not JWT.
- **Introspection is app-side and explicit**; user schemas only; partial snapshots flagged.
- **Migrations at deploy time** for the real metadata DB; pglite Sample keeps the inlined DDL.
- **Metadata isolation**: separate DB + credentials from business Connections.

## 11. M1 acceptance additions (extends `06`)

- A real PostgreSQL Connection can be created, tested, introspected, and **queried read-only end to end**, producing an Answer with Evidence — through the unchanged M0 controller.
- Guardrails hold on real data: **no writes executed** (gate + read-only role + READ ONLY tx), **no credentials/PII to the provider**, every Key Finding cites recorded Evidence (G3), every executed statement recorded as a QueryRun (G4).
- The credential blob is **encrypted at rest**; no endpoint, error, or log path leaks plaintext (asserted).
- A slow query is **cancelled** on client disconnect (the backend statement actually stops).
- First-run bootstrap creates the initial Owner; `/api/setup` is disabled afterward; Connection endpoints enforce Connection roles.
- Metadata lives in a separate database from any business Connection.

## 12. Detailed data model

See `12-m1-data-model.md` — the Drizzle schema for `User` / `Session` / `Connection` / `ConnectionMembership` / `SchemaSnapshot`, the `Investigation.dataSourceId` evolution (minimal implicit Data Source until M2), and the deploy-time migration story.
