# 01 — Architecture (M0)

This defines the M0 component architecture, the ports (interfaces) that keep M0 forward-compatible with M1/M2, the request/data flow of one Investigation turn, and the trust boundary.

## 1. Component overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ apps/web (Next.js)                                                    │
│  React thread UI ── SSE ──▶ route handlers (/api/...)                 │
└───────────────┬──────────────────────────────────────────────────────┘
                │ calls (in-process, M0)
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ packages/core  (framework-agnostic domain)                           │
│                                                                       │
│   InvestigationService ──▶ AgentRunner (state machine)               │
│                               │                                       │
│        ┌──────────────────────┼───────────────────────────┐          │
│        ▼                      ▼                            ▼          │
│   AgentProvider          SafetyGate                  Redactor         │
│   (LLM port)             (deterministic)             (Policy-bound)   │
│        │                      │                            │          │
│        │                      ▼                            │          │
│        │                 QueryExecutor ◀── Connector ──────┘          │
│        │                      │                                       │
│        ▼                      ▼                                       │
│   EvidenceRecorder ◀── Investigation/Answer model ──▶ MetadataStore   │
└───────────────────────────────────────────────────────────────────────┘
                                   │
                 ┌─────────────────┴───────────────────┐
                 ▼                                      ▼
        connectors/sample (pglite seed)        db (pglite, drizzle)
```

Key idea: **AI proposes, the application controls** (PRD AI Execution Boundary). The `AgentProvider` (the LLM) only emits plans, SQL drafts, and interpretations. It never touches the database. Everything between the provider and the data — `SafetyGate`, `QueryExecutor`, `Redactor`, `EvidenceRecorder` — is deterministic application code.

## 2. Ports (interfaces)

All live in `packages/core/ports`. M0 ships one implementation of each; M1/M2 add more without touching callers.

### 2.1 Connector & QueryExecutor

```ts
// A data source endpoint. M0: SampleConnector (pglite). M1: PostgresConnector.
export interface Connector {
  readonly id: string;            // e.g. "sample"
  readonly kind: 'sample' | 'postgres';
  getSchemaSnapshot(): Promise<SchemaSnapshot>;   // structural metadata only
  getExecutor(): QueryExecutor;
}

export interface QueryExecutor {
  // Executes ONE already-safety-checked, read-only statement against ONE connection.
  run(sql: string, opts: ExecOptions): Promise<QueryRunResult>;
}

export interface ExecOptions {
  rowLimit: number;          // hard cap appended/enforced
  timeoutMs: number;
  statementTimeoutMs?: number;
}

export interface QueryRunResult {
  columns: ColumnMeta[];
  rows: ReadonlyArray<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}
```

`QueryExecutor.run` is only ever called by the application after `SafetyGate.check` returns `allow`. Each call targets exactly one Connection — there is no cross-Connection execution (PRD D1: comparison happens at the reasoning layer, not in SQL).

### 2.2 SafetyGate

```ts
export interface SafetyGate {
  check(sql: string, ctx: SafetyContext): SafetyDecision;   // deterministic, sync
}

export interface SafetyContext {
  policy: Policy;                 // M0: the Sample's default Policy
  allowedTables: ReadonlySet<string>;
  sensitiveColumns: ReadonlySet<string>;  // "table.column"
}

export type SafetyDecision =
  | { verdict: 'allow'; touchedTables: string[]; touchedSensitive: string[]; needsConfirmation: boolean }
  | { verdict: 'reject'; reason: SafetyRejectReason; detail: string };

export type SafetyRejectReason =
  | 'not_read_only'        // INSERT/UPDATE/DELETE/DDL/etc.
  | 'multiple_statements'
  | 'unauthorized_table'
  | 'admin_or_maintenance' // VACUUM, COPY, SET ROLE, ...
  | 'unparseable';
```

The gate parses SQL with `pgsql-ast-parser` and decides on the AST, never on regex. See `03-agent-and-safety.md` for the full rule list. **The AgentProvider cannot override a `reject`.**

### 2.3 Redactor

```ts
export interface Redactor {
  // Bounds and redacts a raw QueryRunResult before it is (a) recorded as Evidence
  // and (b) summarized back to the AgentProvider.
  redact(result: QueryRunResult, ctx: RedactionContext): RedactedResult;
}

export interface RedactedResult {
  columns: ColumnMeta[];
  sampleRows: ReadonlyArray<Record<string, unknown>>; // capped, sensitive values masked
  aggregateSummary?: Record<string, unknown>;
  rowCount: number;
  redactedColumns: string[];
  truncated: boolean;
}
```

The Redactor is the only thing whose output is allowed to flow back to the `AgentProvider` (PRD Result Redaction and Bounded Context). It never emits credentials, full secrets, or unauthorized fields.

### 2.4 AgentProvider (the LLM port)

```ts
export interface AgentProvider {
  // Streams structured agent steps. Receives ONLY bounded context, never raw DB access.
  runInvestigation(input: AgentInput, signal: AbortSignal): AsyncIterable<AgentStep>;
}

export interface AgentInput {
  question: string;
  threadHistory: TurnSummary[];          // prior turns in this Investigation
  dataSourceContext: DataSourceContext;  // overview, verified glossary/mapping (M0: from Sample)
  schemaSnapshot: SchemaSnapshot;
  // The provider proposes SQL; it is given NO connection, credentials, or executor.
  toolResults?: ToolResult[];            // bounded results the app fed back after execution
}

export type AgentStep =
  | { type: 'reasoning'; label: LocalizedText }          // transient, streamed
  | { type: 'propose_sql'; purpose: LocalizedText; sql: string; connectorId: string }
  | { type: 'need_clarification'; missing: MissingInfo; options?: ClarifyOption[] }
  | { type: 'final'; answer: AgentAnswerDraft };         // app validates → Answer
```

M0 provides two implementations: a real provider (env-configured, Anthropic/OpenAI-compatible) and a `FixtureProvider` that replays scripted `AgentStep`s for the Sample scenarios so the smoke suite is hermetic (`03` and `05`).

### 2.5 EvidenceRecorder & MetadataStore

```ts
export interface EvidenceRecorder {
  record(run: RecordedQueryRun): Promise<EvidenceRef>;  // binds to an Answer version
}

export interface MetadataStore {
  createInvestigation(init: NewInvestigation): Promise<Investigation>;
  appendAnswerVersion(investigationId: string, answer: Answer): Promise<Answer>;
  getInvestigation(id: string): Promise<InvestigationWithAnswers | null>;
  listInvestigations(opts: ListOpts): Promise<InvestigationListItem[]>;  // history rail
}
```

In M0 both the MetadataStore and the Sample data live in **pglite** (separate logical databases / schemas), satisfying the PRD rule that product metadata is never written into the business database while keeping zero external dependencies.

## 3. Data flow of one Investigation turn

1. **UI → API.** User submits a question (or follow-up). `POST /api/investigations` (new) or `POST /api/investigations/:id/turns` (follow-up). The handler opens an SSE stream.
2. **InvestigationService** loads/creates the Investigation, resolves the bound Data Source (M0: Sample), and starts the `AgentRunner`.
3. **AgentRunner ↔ AgentProvider.** The provider streams `reasoning` steps (forwarded to the client as SSE `reasoning` events) and eventually a `propose_sql` step.
4. **SafetyGate.check.** Deterministic. On `reject` → the runner converts it to an Unblock Path / Answer status (no execution). On `allow` → continue.
5. **QueryExecutor.run** against the single target Connector, with `rowLimit`/`timeoutMs` from Policy.
6. **Redactor.redact.** Produces the bounded result. The raw result is recorded by **EvidenceRecorder**; the bounded result is fed back to the provider as a `toolResult`.
7. Steps 3–6 repeat until the provider emits `final` (or `need_clarification`).
8. **AgentRunner validates** the `final` draft against the Answer Contract (every Key Finding cites a recorded Evidence ref; Status × Confidence legal; non-`Answered` carries an Unblock Path). Invalid drafts are rejected/repaired, never shown raw.
9. **MetadataStore.appendAnswerVersion** persists the Answer as a new version; the SSE stream emits a final `answer` event and closes.

## 4. Trust boundary (M0)

- The **AgentProvider is treated as external** even in M0. Only `Redactor` output crosses to it.
- The **SafetyGate is mandatory and deterministic**; the provider cannot bypass it.
- Sample data has no secrets, but the Redactor and Gate are exercised anyway so the boundary is real and tested before M1 brings real data.
- Errors surfaced to the client are product-level (see PRD `Application States and Errors`); raw SQL errors, provider errors, and stack traces never reach the UI.

## 5. Runtime (M0)

Single Node process running Next.js. The `packages/core` domain runs in-process behind the route handlers. pglite is embedded in the same process. This is intentionally the simplest thing that exercises the full loop; M1 may extract the executor into a worker (PRD Worker/Agent Runtime is explicitly post-V1).
