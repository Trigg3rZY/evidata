# 10 — M0 Data Model & Persistence

The persistence layer for M0: the `MetadataStore` entities, how the Answer Contract is stored without drift, how every executed query is recorded, and the Drizzle schema that backs it all. This is the implementation-depth companion to the one-line sketch in `07 §3` and to the `MetadataStore`/`EvidenceRecorder` ports in `01 §2.5`.

PRD references: `Answer Contract`, `Evidence Recorder`, `Answer Versioning`, `Success Measurement → Guardrail Signals` (G3 evidence-cited, G4 every-run-recorded), `Product-level Architecture Boundaries` (metadata never co-located with business data).

## 1. Scope

M0 persists the conversation-first trusted-answer loop against the Sample Data Source. The store must:

- hold Investigations, their Turns, and every Answer **version** (append-only, never overwritten);
- record every executed query as a `QueryRun` and every recorded Evidence item, each bound to the Answer version it supports (guardrail G4);
- store each Answer as a **validated** Answer Contract document so the renderer and producer share one shape with no schema drift (guardrail G3 gates the write);
- live in `pglite` (embedded Postgres) in a **metadata schema that is physically separate** from the Sample's business schema (PRD: product metadata is never written into a business database).

Out of scope for M0 (deferred): `User`/`Session`/`Connection`/`DataSource` and their memberships (→ M1/M2, see `08`/`09`); the review lifecycle of `Suggestion` (M0 records only).

## 2. Entities & relationships

```
Investigation ─< Turn
      │
      └─< Answer (version)        ── one row per version; is_latest flags the head
              │
              ├─< Evidence         ── recorded, redacted; cited by Key Findings in the payload
              │       │
              │       └─ QueryRun  ── the as-executed query behind an Evidence item (G4)
              │
              └─< Suggestion       ── recorded only in M0 (status = 'recorded')
```

- An **Investigation** is bound to one Data Source for its lifetime (M0: always the Sample).
- A **Turn** is a user message or an agent reply; an agent Turn points at the Answer version it produced.
- An **Answer** row is one immutable version. Follow-ups/reruns append a new version and demote the prior head (see §6).
- An **Evidence** row is a redacted, recorded result bound to a specific Answer version; the Answer payload's `keyFindings[].evidenceIds` resolve to these (`evidence_ref`, e.g. `"E1"`).
- A **QueryRun** is the audit record of one executed statement (G4). Each Evidence item has exactly one backing QueryRun; a rejected/blocked proposal produces a QueryRun with a non-`ok` status and **no** Evidence.
- A **Suggestion** is raised by an Unblock action (`notify_admin_verify` / `pick_definition(createsSuggestion)`); M0 records it, M2 adds review (`09 §3`).

## 3. Storage strategy: validated document + normalized provenance

The Answer Contract is a deeply nested unit (findings, evidence, assumptions, caveats, charts, unblock, meta). M0 stores it two ways, deliberately:

1. **`answers.payload` (JSONB) is the canonical contract document.** It is written only after `validateAnswer()` returns `[]` and `validateAnswerSchema()` passes (guardrail G3 — invalid answers are never persisted). The frontend renders from this single self-contained object; no join is required to show an Answer, and producer and renderer share the exact `@evidata/answer-contract` type.
2. **`evidence` and `query_runs` are normalized provenance rows** written by the `EvidenceRecorder` *during* execution, before the final Answer is assembled. They are the audit trail: they enforce the version binding, back the G4 count, and let the app answer "what ran for this Answer?" without parsing JSON.

The Evidence items inside `answers.payload` are assembled *from* the recorded `evidence` rows at finalize time, so the two are consistent by construction. The small redundancy is intentional: the document keeps the contract portable; the rows keep provenance queryable and auditable. Columns promoted out of the payload (`status`, `confidence`, `version`, `is_latest`, timestamps) exist for indexing and history queries — the payload remains the source of truth for their values.

## 4. Drizzle schema (M0 draft)

`packages/db` (spec 01). pglite speaks Postgres, so the schema uses `pg-core`; M1 reuses it verbatim against real Postgres. Identifiers are application-generated text ids (e.g. cuid2). Column names are `snake_case` (matching the Sample SQL in `05`); Drizzle field names are camelCase.

```ts
import {
  pgSchema, text, integer, bigint, boolean, jsonb, timestamp, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// All product metadata lives in its own schema, never co-located with business data.
export const meta = pgSchema('evidata_meta');

export const investigations = meta.table('investigations', {
  id: text('id').primaryKey(),
  dataSourceId: text('data_source_id').notNull(),   // M0: always 'sample'
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const turns = meta.table('turns', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull().references(() => investigations.id),
  role: text('role', { enum: ['user', 'agent'] }).notNull(),
  question: text('question'),                        // user turns
  answerVersion: integer('answer_version'),          // agent turns → answers.version
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  byInvestigation: index('turns_investigation_idx').on(t.investigationId, t.createdAt),
}));

export const answers = meta.table('answers', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull().references(() => investigations.id),
  version: integer('version').notNull(),             // 1-based, monotonic per investigation
  status: text('status').notNull(),                  // AnswerStatus (promoted for queries)
  confidence: text('confidence').notNull(),          // Confidence (promoted for queries)
  isLatest: boolean('is_latest').notNull(),
  createdAfterKind: text('created_after_kind'),       // 'clarification'|'followup'|'rerun'|'definition_correction'
  createdAfterFromVersion: integer('created_after_from_version'),
  payload: jsonb('payload').notNull(),               // the validated Answer contract document
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  versionUnique: uniqueIndex('answers_version_uq').on(t.investigationId, t.version),
  latestIdx: index('answers_latest_idx').on(t.investigationId, t.isLatest),
  // At most one latest head per Investigation — a DB guarantee, not just app logic.
  oneLatest: uniqueIndex('answers_one_latest_uq').on(t.investigationId).where(sql`${t.isLatest}`),
}));

export const queryRuns = meta.table('query_runs', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull().references(() => investigations.id),
  answerVersion: integer('answer_version').notNull(),
  connectorId: text('connector_id').notNull(),       // single connection per run
  sql: text('sql').notNull(),                        // as-executed (post-SafetyGate, post-bounds)
  status: text('status').notNull(),                  // 'ok'|'timeout'|'connection_lost'|'zero_rows'|'error'
  rowCount: integer('row_count').notNull(),
  truncated: boolean('truncated').notNull(),
  elapsedMs: integer('elapsed_ms').notNull(),
  // NOTE: no raw result rows are stored here (forward-safe for M1 real data); the
  // redacted sample lives on `evidence` once the result clears the Redactor.
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
}, (t) => ({
  byVersion: index('query_runs_version_idx').on(t.investigationId, t.answerVersion),
}));

export const evidence = meta.table('evidence', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull().references(() => investigations.id),
  answerVersion: integer('answer_version').notNull(),
  evidenceRef: text('evidence_ref').notNull(),       // 'E1' — referenced by keyFindings in the payload
  queryRunId: text('query_run_id').notNull().references(() => queryRuns.id),
  purpose: text('purpose').notNull(),
  connectorId: text('connector_id').notNull(),
  tables: jsonb('tables').notNull(),                 // string[]
  sql: text('sql').notNull(),                        // policy-bounded, as-executed (PRD D4)
  resultSummary: text('result_summary').notNull(),
  sampleRows: jsonb('sample_rows'),                  // redacted, capped
  safety: text('safety').notNull(),                  // 'auto_executed'|'confirmed_by_user'|'rejected'
  policyNotes: text('policy_notes').notNull(),
  redactedColumns: jsonb('redacted_columns').notNull(), // string[]
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  refUnique: uniqueIndex('evidence_ref_uq').on(t.investigationId, t.answerVersion, t.evidenceRef),
}));

export const suggestions = meta.table('suggestions', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull().references(() => investigations.id),
  answerVersion: integer('answer_version'),
  kind: text('kind').notNull(),                      // UnblockActionKind that created it
  targetRef: text('target_ref'),                     // e.g. 'invoices.customer_ref→accounts.id'
  description: text('description').notNull(),
  status: text('status').notNull().default('recorded'), // M0: always 'recorded'; M2 adds review
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
```

The `evidence` columns draw their names from `@evidata/answer-contract`'s `Evidence` so persistence introduces no new vocabulary; per-execution fields (`status`, `elapsedMs`, `rowCount`, `truncated` — the contract's `EvidenceExecutionMeta`) live on `query_runs`, and `dataSourceId`/`dataSourceName` resolve via the parent Investigation rather than being duplicated per row.

## 5. MetadataStore operations

The `MetadataStore` port (`01 §2.5`) maps to this schema as:

| Method | Behaviour |
|---|---|
| `createInvestigation(init)` | Insert one `investigations` row (M0 `dataSourceId='sample'`); title defaults from the first question. |
| `appendAnswerVersion(investigationId, answer)` | Transaction: validate (`validateAnswer` + schema) → demote current head (`is_latest=false`) → insert the new `answers` row with `version = max+1`, `is_latest=true` → insert the agent `turns` row. Uses the pure `appendAnswerVersion` helper from `@evidata/answer-contract` to compute the version/meta (§6). |
| `getInvestigation(id)` | Load the investigation, its turns (ordered), and **all** answer versions (latest last) → `InvestigationWithAnswers`. |
| `listInvestigations(opts)` | History rail: investigations with their latest answer's status/title/updatedAt, paged. |

`EvidenceRecorder.record(run)` (`01 §2.5`) inserts one `query_runs` row and, when the run produced a redacted result, one `evidence` row referencing it, both bound to the *pending* Answer version; it returns the `EvidenceRef` (`evidenceRef`) the runner stitches into the draft. It is called once per executed query — the basis of the G4 count.

## 6. Answer versioning (append-only)

PRD: follow-ups and reruns produce new versions; prior versions are never overwritten and remain retrievable.

- Versions are 1-based and monotonic per Investigation (`answers_version_uq`).
- Exactly one row per Investigation has `is_latest=true` (the head); appending a version demotes the previous head in the same transaction. This is enforced at the DB level by a **partial unique index** (`answers_one_latest_uq` on `investigation_id WHERE is_latest`), not app logic alone.
- `created_after_kind` / `created_after_from_version` record provenance (which prior version, and why: clarification/followup/rerun/definition_correction).
- The version math and meta are computed by the already-shipped, tested pure helper `appendAnswerVersion` (`@evidata/answer-contract`, contract test C5), so the store does no ad-hoc version arithmetic.

A rerun re-executes and produces a fresh version with new `query_runs`/`evidence`; it never mutates the earlier version's rows.

## 7. Isolation, lifecycle & config

- **Schema isolation.** Metadata lives in the `evidata_meta` schema; the Sample's business tables (`05`) live in a separate schema/database in the same pglite instance. Nothing in `evidata_meta` is ever written into the business schema, and vice-versa (PRD `Product-level Architecture Boundaries`). M1 promotes `evidata_meta` to a real Postgres database with separate credentials from any business Connection.
- **Startup.** On boot, run Drizzle migrations against the metadata schema (idempotent), then seed the Sample business schema (`05 §3`). Both are deterministic so smoke runs are reproducible.
- **Config.** `SAMPLE_DATA_SOURCE=off` skips the Sample seed; the metadata store still initializes (the app runs with no Data Source). Metadata persistence itself is always on.

## 8. Migrations

Forward-only, versioned Drizzle migrations (`07 §3`). M0 ships the six tables above as the initial migration. M1/M2 add tables (`User`, `Connection`, `DataSource`, …) and turn `investigations.data_source_id` into a real FK (`08 §4`, `09 §5`) via additive migrations — M0 rows continue to resolve to the Sample.

## 9. Guardrail traceability

| Guardrail (PRD / `06 §2`) | Enforced here |
|---|---|
| **G3 evidence-cited** | `answers.payload` is written only after `validateAnswer()==[]` and schema validation pass; every `keyFindings[].evidenceIds` resolves to an `evidence` row for that version (`evidence_ref`). |
| **G4 every-run-recorded** | One `query_runs` row per executed statement (incl. non-`ok`); the count is assertable in tests (`06`). |
| **read-only / no writes** | Enforced upstream by the SafetyGate (`03 §3`); a blocked write yields a `query_runs` row only if it was *attempted* post-gate — by construction the gate prevents execution, so blocked mutations produce **no** `query_runs` and a `BlockedByPolicy` Answer. |
| **metadata isolation** | `evidata_meta` schema is physically separate from business data (§7). |

## 10. What M1/M2 change

The M0 tables are stable; later milestones are additive (`07 §3`): M1 adds identity/connection tables and the real metadata database; M2 adds Data Source / calibration / membership tables and the `Suggestion` review lifecycle (`status: open → accepted/rejected`). The Answer/Evidence/QueryRun core — the audit of the trusted-answer loop — is unchanged from M0 onward.
