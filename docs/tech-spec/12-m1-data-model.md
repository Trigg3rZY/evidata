# 12 — M1 Data Model (Identity, Connections, Snapshots)

The persistence M1 adds on top of the M0 metadata schema (`10`): local accounts and sessions, encrypted Connections and their memberships, captured Schema Snapshots, and the minimal Data Source that lets the trusted-answer loop run on real data before M2's full calibration exists.

All tables live in the same isolated `evidata_meta` schema as M0 (`10 §7`); M1 only changes the **host** — that schema graduates from embedded pglite to a real, separate Postgres database (`08 §9`). Forward-only Drizzle migrations, applied at deploy time.

PRD references: `Real Connections`, `Credential handling` (decision 4), `Metadata isolation` (decision 5), `First-run & Accounts`, `Schema Snapshot`.

## 1. Entities

```
User ─< Session
User ─< ConnectionMembership >─ Connection ─< SchemaSnapshot
                                   │
                                   └─ DataSource (minimal, M1) ─< Investigation … (M0 graph, 10)
```

- A **User** is a local account; a **Session** is a server-side, revocable login (the cookie holds an opaque token; only its hash is stored).
- A **Connection** is a real database endpoint with an **encrypted** credential blob; **ConnectionMembership** grants `owner`/`admin` on it.
- A **SchemaSnapshot** is a captured, structural picture of a Connection (app-side; the AI never connects).
- A **DataSource** (minimal in M1) wraps one Connection so `Investigation.dataSourceId` becomes a real FK; M2 (`09`) extends it with context/glossary/policy/lifecycle.

## 2. Drizzle schema (M1 additions)

```ts
import { sql } from 'drizzle-orm';
import { pgSchema, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { meta, investigations } from './schema'; // the M0 evidata_meta schema (10 §4)

export const users = meta.table('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(), // Argon2id (08 §5)
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = meta.table('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(), // SHA-256 of the cookie token; never the token itself
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

export const connections = meta.table('connections', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),                 // 'postgres'
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  database: text('database').notNull(),
  sslMode: text('ssl_mode').notNull(),          // 'require' | 'verify-full' | 'disable' | …
  credentialBlob: jsonb('credential_blob').notNull(), // EncryptedSecret (08 §3) — never returned by the API
  health: text('health').notNull(),             // Connection state machine (08 §7)
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const connectionMemberships = meta.table('connection_memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  connectionId: text('connection_id').notNull().references(() => connections.id),
  role: text('role', { enum: ['owner', 'admin'] }).notNull(),
}, (t) => [uniqueIndex('conn_member_uq').on(t.userId, t.connectionId)]);

export const schemaSnapshots = meta.table('schema_snapshots', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull().references(() => connections.id),
  status: text('status').notNull(),             // 'complete' | 'partial' | 'failed'
  partial: boolean('partial').notNull(),
  payload: jsonb('payload').notNull(),          // the SchemaSnapshot document (08 §4)
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
}, (t) => [index('snapshots_connection_idx').on(t.connectionId, t.capturedAt)]);

// Minimal Data Source so Investigation.dataSourceId becomes a real FK (M2 extends this).
export const dataSources = meta.table('data_sources', {
  id: text('id').primaryKey(),                  // 'sample' for the built-in Sample
  name: text('name').notNull(),
  kind: text('kind').notNull(),                 // 'sample' | 'postgres'
  connectionId: text('connection_id').references(() => connections.id), // null for the Sample
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
```

## 3. Evolving the M0 tables

- `investigations.data_source_id` was free text defaulting to `'sample'` in M0 (`10 §4`). M1's migration: create `data_sources`, insert the built-in `('sample', …)` row, then add the FK `investigations.data_source_id → data_sources.id`. Existing M0 rows already say `'sample'`, so the backfill is a no-op and the constraint applies cleanly.
- No other M0 table changes — `answers`/`evidence`/`query_runs`/`turns`/`suggestions` are unchanged. The trusted-answer audit core is stable from M0 onward (`07 §3`).

## 4. Migrations & deploy

- M1 schema changes are generated as ordinary forward-only Drizzle migrations (`drizzle-kit generate`) committed under `packages/db/drizzle`. **As built (M1.8): the default host is file-backed pglite**, which applies the inlined `SCHEMA_SQL` once (idempotent — skipped when `evidata_meta` already exists), so a persisted `METADATA_DATA_DIR` is reused across restarts with no separate database. The migration files below are the source of truth for the real-Postgres host (`08 §9`).
- They are applied by a **deploy-time `db:migrate` step** (plain Node, unbundled — the file-based migrator works there) against the real `METADATA_DATABASE_URL`, before the app serves traffic. The runtime app never applies DDL for the real Postgres host (contrast embedded pglite, which execs the inlined `SCHEMA_SQL`; see `10 §7`, `08 §9`).
- The metadata database has **separate credentials** from any business Connection (decision 5); business credentials live only in `connections.credential_blob`, encrypted (`08 §3`).

## 5. What M2 adds (forward pointer)

M2 (`09`) extends `data_sources` (lifecycle Draft→Published→Archived, `DataSourceConnection`, `DataSourceContext`, `BusinessGlossaryTerm`, `EntityMapping`, `Policy`, `DataSourceMembership`) and gives `Suggestion` a review lifecycle. The M1 tables here are the identity/connection substrate those build on.
