# 03 — Agent Orchestration & Safety (M0)

How an Investigation turn is driven: the agent state machine, the deterministic Safety Gate, the Redactor, the Evidence Recorder, the Decision-Boundary → Unblock mapping, the streamed events, and the FixtureProvider that makes M0 hermetically testable.

PRD references: `AI Execution Boundary`, `SQL Safety Gate`, `Result Redaction and Bounded Context`, `Evidence Recorder`, `Interaction Model`, `Decision Boundaries`, `Unblock Path`.

## 1. AgentRunner state machine

The `AgentRunner` (in `packages/core/agent`) drives one turn. The provider is a streaming oracle; the runner is the controller that enforces the boundary.

```
        ┌──────────┐
        │  START   │  load Investigation + Sample DataSourceContext + SchemaSnapshot
        └────┬─────┘
             ▼
        ┌──────────┐   provider emits AgentStep stream
        │ THINKING │◀───────────────────────────────┐
        └────┬─────┘                                 │
   reasoning │ propose_sql │ need_clarification │ final
             ▼             ▼                    ▼     │
   emit SSE       ┌─────────────┐        ┌──────────┐│
   reasoning      │ SAFETY_GATE │        │ FINALIZE ││
   (loop) ────────│  check(sql) │        └────┬─────┘│
                  └──────┬──────┘             │       │
              reject ◀───┤                    │       │
                  │      │ allow              │       │
                  ▼      ▼                    │       │
            ┌──────────┐ ┌──────────┐         │       │
            │ UNBLOCK  │ │ EXECUTE  │         │       │
            │ (no exec)│ │ run+redact│        │       │
            └────┬─────┘ └────┬─────┘         │       │
                 │            │ record evidence│      │
                 │            ▼  feed bounded  │      │
                 │       result back ──────────┴──────┘
                 ▼
            ┌──────────┐
            │ FINALIZE │  validateAnswer() → persist version → SSE answer
            └────┬─────┘
                 ▼
              ┌─────┐
              │ END │
              └─────┘
```

### States

- **THINKING** — consume `AgentStep`s from `AgentProvider.runInvestigation`. `reasoning` steps are forwarded to the client as SSE and (on success) collapse into `whatIDid`.
- **SAFETY_GATE** — on `propose_sql`, run `SafetyGate.check` (sync, deterministic). `reject` → UNBLOCK or BlockedByPolicy. `allow` with `needsConfirmation` → emit a confirmation request (M0 auto-confirms low-risk per Sample Policy; the confirmation UI path is stubbed and exercised by one scenario).
- **EXECUTE** — `QueryExecutor.run` (single connection, Policy `rowLimit`/`timeoutMs`) → `Redactor.redact` → `EvidenceRecorder.record` (raw, bound to the pending version) → feed the **bounded** result back to the provider as a `toolResult`.
- **UNBLOCK** — build an `UnblockPath` from the reject reason / clarification (mapping in §5); produce a non-`Answered` Answer.
- **FINALIZE** — assemble the `Answer`, run `validateAnswer`. If violations: re-prompt the provider once with the violation list; if still invalid, downgrade to `NoReliableAnswer` + Unblock Path (never show an invalid answer). Persist as a new version; emit SSE `answer`.

### Limits (M0 defaults; tunable, see Policy)

- Max provider↔execute iterations per turn: 4.
- Max queries per turn: 6.
- Per-query `timeoutMs`: 5000; `rowLimit`: 1000.
- Whole-turn budget: 60s, then `Partial`/`NoReliableAnswer` with a Caveat.

## 2. Follow-up vs New Investigation (decision)

When a message arrives on an existing thread, the runner classifies it before running:

- Same Data Source + continues prior intent (pronouns/refs to prior answer, refinement, drill-down, clarification reply) → **follow-up**: append turn + new Answer version. `threadHistory` is passed to the provider.
- Different Data Source, or clearly unrelated topic → **new Investigation** (new thread).
- Ambiguous → the agent asks (a `NeedsClarification` with `pick_candidate`: "continue this investigation" vs "start a new one").

M0 implements this as a lightweight classifier (heuristics + a cheap provider call); the contract effect (append-version vs new-investigation) is what matters and is tested.

## 3. SQL Safety Gate (deterministic)

`packages/core/safety`. Parses with `pgsql-ast-parser`; decisions are made on the AST, never regex. The Gate is mandatory and the provider cannot override it.

Rules (M0):

1. **Parse** — unparseable → `reject: unparseable`.
2. **Single statement** — more than one → `reject: multiple_statements`.
3. **Read-only only** — statement must be `SELECT` (or `WITH … SELECT`, `EXPLAIN` of a select). Any `INSERT/UPDATE/DELETE/MERGE/DDL/DCL/TRUNCATE/COPY` → `reject: not_read_only`.
4. **No admin/maintenance** — `SET ROLE`, `VACUUM`, `ANALYZE`, `COPY … TO/FROM`, function calls on a denylist (e.g. `pg_read_file`, `dblink`, `lo_*`) → `reject: admin_or_maintenance`.
5. **Authorized tables** — every referenced relation must be in `allowedTables` → else `reject: unauthorized_table`.
6. **Sensitive columns** — record touched sensitive columns; the Redactor enforces masking (the Gate flags, the Redactor acts).
7. **Bounds** — if no `LIMIT`, the executor appends the Policy `rowLimit`; a statement timeout is always set.
8. **Confirmation triggers** — broad scans (no `WHERE` on a large table), sensitive-column access, or missing time window set `needsConfirmation: true` (PRD default-strict Policy).

Output: `SafetyDecision` (`allow` with touched tables/sensitive + `needsConfirmation`, or `reject` with reason + product-level detail). The detail is product-level text; raw parser errors never reach the client.

## 4. Redactor & bounded context

`packages/core/redaction`. Between execution and both (a) Evidence recording and (b) the provider feedback:

- Mask sensitive column **values** per Policy; mask/omit out-of-scope identifiers (PRD D4) for the role that will view the Evidence.
- Truncate to `rowLimit`; prefer an `aggregateSummary` + a small `sampleRows` set over full rows.
- Never emit credentials, secrets, or unauthorized fields.
- The provider only ever receives `RedactedResult` — the single crossing point to the (externally-treated) model.

## 5. Decision Boundaries → Unblock Path mapping

The runner builds the `UnblockPath` deterministically from the trigger (implements PRD's table; types in `contracts/answer-contract.ts`):

| Trigger (source) | `MissingKind` | `UnblockAction.kind` | status |
|---|---|---|---|
| unclear business object (provider `need_clarification`) | `business_object` | `specify_object` / `pick_candidate` | NeedsClarification |
| missing time range | `time_range` | `set_time_range` | NeedsClarification |
| Gate `unauthorized_table` | `authorization` | `request_access` (createsSuggestion) | BlockedByPolicy |
| Gate `not_read_only` (mutation) | `mutation_required` | `view_mutation_draft` | BlockedByPolicy |
| multiple plausible definitions | `ambiguous_definition` | `pick_definition` (choices; may createSuggestion) | NeedsClarification |
| cross-Connection without verified mapping | `unverified_mapping` | `notify_admin_verify` (createsSuggestion) | NoReliableAnswer |
| results don't support a conclusion | `insufficient_results` | `narrow_question` | NoReliableAnswer |

Actions with `createsSuggestion: true` write a Suggested item (correction loop). In M0 there is no Admin UI, so the item is recorded and the action is acknowledged ("Created a Suggested item for Admin"); M2 builds the review side.

## 6. Streamed events (SSE)

The runner emits an ordered event stream (wire format in `04-api-and-frontend.md`):

- `reasoning` — `{ label }` transient step; UI shows live, collapses into `whatIDid`.
- `query` — `{ purpose, status }` when a query runs (no SQL/rows on the wire until the Evidence is finalized).
- `need_input` — a clarification/Unblock turn that needs the user.
- `answer` — the validated final `Answer` (full contract object).
- `error` — product-level failure (never raw); maps to PRD Application States.

Rules from PRD `Transient Investigation Updates`: steps show while active, collapse when done, stay visible on failure/blocked/clarification, and never expose provider/model/raw payloads.

## 7. AgentProvider implementations

- **Real provider** — env-configured (`AGENT_PROVIDER`, `AGENT_MODEL`, API key). Uses a structured tool/loop protocol to emit `AgentStep`s. Provider/model identifiers never cross to the client.
- **FixtureProvider** — replays scripted `AgentStep` sequences keyed by Sample scenario id (spec 05). Deterministic, no network, no key. It is the default in tests and can be toggled for local dev (`AGENT_PROVIDER=fixture`). This makes the M0 smoke suite the reliable acceptance gate without depending on a live model.

## 8. Guardrail enforcement points (tie to PRD Success Measurement)

- read-only: enforced in SAFETY_GATE (rule 3) — any execute path requires `allow`.
- no secrets to provider: enforced in Redactor (§4) — provider input is `RedactedResult` only.
- every Key Finding cites Evidence: enforced in FINALIZE via `validateAnswer`.
- every query recorded: EXECUTE always calls `EvidenceRecorder.record` before feeding back.

Each has a corresponding smoke assertion in spec 06.
