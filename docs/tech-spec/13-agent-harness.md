# 13 — Agent Harness (M0.5)

Systematizes the AI layer into a governed *harness* — the orchestration around the model, in the spirit of a coding-agent harness. M0 grew the AI behavior reactively (JSON repair, transient retries, force-finalize, data-source scoping, token metering); each is a real harness capability but they were added ad-hoc. This spec names the stages, gives each a boundary and a test, and fills the gaps the live trial exposed:

- A greeting (`你好`) runs a full multi-query investigation — no input triage.
- "Write me a DELETE statement" (author SQL, don't run it) is misread as an execution request → `BlockedByPolicy`.
- A Chinese-IME Enter (confirming candidates) submits the message prematurely.
- A running turn can't be interrupted; the server keeps spending tokens after the client gives up.

PRD references: `AI Execution Boundary`, `Interaction Model`, `Decision Boundaries`, `Unblock Path`. Builds on `03 — Agent Orchestration & Safety` (the runner, gate, redactor stay exactly as specified) and `02 — Answer Contract`.

---

## 1. The core principle: Answer vs Message

The Answer Contract (spec 02) governs **claims about the data** — every Key Finding must cite recorded Evidence (G3). But not every assistant turn is a data claim: a greeting, a "what can you do?", an out-of-scope decline, or a drafted SQL statement make **no factual claim about the data** and therefore have no evidence to cite. Forcing them through the Answer machinery is what produces the bugs above (greeting → queries; decline → an awkward `NoReliableAnswer`).

So the harness recognizes two response kinds:

| Kind | Makes a data claim? | Evidence-gated? | Examples | Contract |
| --- | --- | --- | --- | --- |
| **Answer** | yes | yes (G3/G4) | "ACME spend rose 38%…" | spec 02, versioned, persisted |
| **Message** | no | no | greeting, scope/decline, drafted SQL, "what can I ask?" | lightweight, not versioned |

A **Message** is plain assistant text (optionally with a fenced SQL block), clearly marked as *not derived from your data*, streamed as a new SSE `message` event and rendered as a simple bubble (no status badge, no confidence meter, no evidence list). This keeps the contract honest — every *Answer* is still evidence-backed — while letting the assistant be conversational without faking evidence.

### 1.1 The contract boundary a Message must NOT cross (G3 integrity)

A Message is **unvalidated free text** — there is no `validateAnswer` equivalent for it. That is precisely why it is dangerous if mis-scoped: a model could put "ACME spend rose 38%" into a `reply` and it would render as a plain bubble, bypassing the entire Answer Contract. The product's thesis is *the app validates, not the model* — so the Message channel is **restricted to intents that make no claim about the data**: greeting, capabilities, out-of-scope decline, and SQL authoring. Enforcement, in layers (not just a UI badge):

- **By construction** — a Message turn runs **zero `run_sql`** (it never enters the evidence loop). So any specific data figure in a Message is, by definition, *ungrounded* (no query produced it). We therefore treat a data figure in a `reply` as a **defect**, not a feature.
- **By prompt** — the `reply` tool description and system prompt forbid statistics, figures, or claims about the data in `reply`; anything requiring the data must go through `run_sql` → `final_answer` (an evidence-gated Answer).
- **By eval** — the eval harness (§6) asserts that greeting/decline `reply` outputs contain no data-claim patterns; a regression there fails the harness report.
- **By UI** — the Message bubble is visibly *not* an Answer (no status/confidence/evidence chrome) and carries a "not from your data" affordance.

This is an explicit, bounded trade-off: **Message gives up the G3 guarantee in exchange for conversational/authoring turns that make no data claim.** §7 states this plainly rather than pretending the contract is untouched. If the layers above prove insufficient, the fallback is to drop the `reply` route and force every assistant turn through the Answer/Unblock contract (greetings included) — heavier, but fully validated.

### 1.2 Plumbing: the `message` decision threads through four layers

A Message is not an `Answer`, so it needs first-class shapes end to end (this is the load-bearing change):

> **P2 shipped Messages as EPHEMERAL** (resolving the §9 open question toward "not persisted"): no `saveMessage`, no `AssistantMessageRecord`, no DB table. `AgentMessage = { text; sql? }`. A Message makes no data claim, so losing it on reload is acceptable for M0; minimal persistence can follow later. The rest of this section is as-built except where it says `saveMessage`/`AssistantMessageRecord`.

- **`AgentDecision`** (`packages/core/agent/src/types.ts`) gains `| { kind: 'message'; text: LocalizedText; sql?: string }` (`sql` set by `draft_sql`).
- **`RunResult`** becomes a union: `{ kind: 'answer'; answer: Answer; queryRuns } | { kind: 'message'; message: AgentMessage }` (`AgentMessage = { text; sql? }`). The runner returns the message branch immediately when it sees `kind: 'message'` (no gate/execute/validate — there is nothing to validate, and nothing was executed).
- **`InvestigationService.ask`** returns an `AskResult` union; on a message it returns **without persisting** (ephemeral — no `createInvestigation`, no `saveAnswer`, no version chain). Messages do **not** increment the Answer `version` sequence (spec 02 §6).
- **`askStream`** branches on `result.kind`: `answer` → existing `answer` frame; `message` → new `message` frame `{ text, sql? }`. The `usage` frame is emitted in **both** cases (a Message turn still costs ≥1 model round-trip), then `done`.
- **`AgentRunEvent`** + the client reducer (`use-investigation-stream.ts`) + the thread's accumulate-turns model gain `message` and `aborted` cases; the Message renders as a bubble (escaped text; any SQL in a `<pre><code>`, never `dangerouslySetInnerHTML`). The cost footer shows the (small) Message cost.

The FixtureProvider (`packages/core/agent/src/fixture-provider.ts`) derives its step from `reasoning.length + toolResults.length`; since a Message produces neither, the eval/fixtures treat a `message` decision as the **first decision (step 0)** or extend the step counter — noted so the eval harness in §6 can script Message routes.

---

## 2. The pipeline

```
 user input
     │
     ▼
 ① INPUT BOUNDARY  ── composition-aware submit (IME), trim, /clear command
     │
     ▼
 ② INTENT (tool-mediated)  ── the model's FIRST tool choice is the route:
     │       reply │ draft_sql │ run_sql │ cannot_answer
     ├── reply ───────────────────────► MESSAGE (greeting / meta / decline)   0 queries
     ├── draft_sql ──────────────────► MESSAGE (SQL authored, NOT executed)   0 queries
     ├── cannot_answer ──────────────► ANSWER (non-answer + Unblock Path)
     └── run_sql ──► ③ LOOP (spec 03) ─► ANSWER (evidence-backed)
                        │
                        ▼
            ④ EXECUTE → redact → record (G4)   ⑤ REPAIR + VALIDATE (G3)
 ──────────────────────────────────────────────────────────────────────────
 cross-cutting: budget + force-finalize · CANCELLATION · transient retry · usage/telemetry · i18n
```

Stages ③–⑤ and the gate/redactor/recorder are unchanged from spec 03. This spec adds **①, ②**, the **Message** kind, and the **cancellation** cross-cut, and folds the existing reactive capabilities into named cross-cuts.

| Stage | Responsibility | Status |
| --- | --- | --- |
| ① Input boundary | composition-aware Enter, `/clear`, trim | ⚠️ IME bug (this spec) |
| ② Intent | route on first tool: reply / draft_sql / run_sql / cannot_answer | ❌ new |
| ③ Decision loop | budgeted run_sql ↔ execute ↔ final | ✅ spec 03 |
| ④ Execute + evidence | gate → execute → redact → record | ✅ spec 03 |
| ⑤ Repair + validate | JSON repair, contract validation, re-prompt-once | ✅ (12) |
| × budget/force-finalize | last-two-step finalize | ✅ |
| × cancellation | stop button → AbortSignal end-to-end | ❌ new |
| × retry | transient 429/5xx | ✅ |
| × telemetry | usage + per-turn trace | ⚠️ usage done; trace new |

---

## 3. Intent is tool-mediated (no extra classifier call)

Rather than a separate classification round-trip, **the intent decision is the model's first tool choice**, constrained by an expanded tool set and a sharper system prompt. This adds zero round-trips on the happy path and immediately fixes over-exploration: the model can `reply` to a greeting instead of querying.

Tools (extends spec 03 §7):

- **`reply`** *(new)* — `{ text }`. A conversational message: greeting, "what can I help with", or a polite out-of-scope decline. No execution, no evidence. → **Message**.
- **`draft_sql`** *(new)* — `{ sql, explanation }`. Author/explain a SQL statement **as text, never executed** — including DDL/DML the user asks to be *written* (a `DELETE` shown is not a `DELETE` run). Rendered with a copy button and a "not executed" badge. → **Message**.
- **`run_sql`** *(unchanged)* — execute ONE read-only SELECT to gather evidence for a **data question**. Still the only path that touches the database; still behind the SafetyGate.
- **`final_answer`** / **`cannot_answer`** *(unchanged)* — finish a data question as an Answer / a non-answer + Unblock Path.

System-prompt routing rule (added near the existing scope rule in `buildSystemPrompt`):

> Decide what the user wants before acting. If it's small talk or a question about your capabilities, use `reply`. If it asks you to **write, draft, or explain** a SQL statement (even a write/DELETE/UPDATE), use `draft_sql` — produce the SQL as text; do NOT execute it. Only use `run_sql` to fetch data needed to answer a question **about the data**. If a question is unrelated to this data source, `reply` with a short decline. Never run a query to answer a greeting.

This makes the three live bugs fall out of one mechanism:

- `你好` → `reply` ("Hi — I can answer questions about <data source>; try …"), **0 queries**.
- "帮我写条删除 amount>30 的 SQL" → `draft_sql` → shows `DELETE FROM campaign_spend WHERE amount > 30;` + "not executed", **no policy block** (it's text, not an execution).
- "今天天气" → `reply` decline (replaces the `cannot_answer(insufficient_results)` stopgap from spec 12; friendlier, still 0 queries).

**Execute vs author (the distinction that matters).** Authoring a mutation is text (`draft_sql` → Message). *Executing* one is the boundary: if the user actually asks to run a write ("把这些行删掉/run this delete"), the model uses `run_sql`, the SafetyGate rejects it (`not_read_only`), and the existing `BlockedByPolicy` + `view_mutation_draft` path applies (spec 03 §5). The gate remains the backstop regardless of intent — `draft_sql` cannot execute, and `run_sql` cannot mutate.

**Robustness — and why a greeting needs a deterministic guard.** The model could still misroute (e.g., `run_sql` for `你好`). Note the existing backstop does *not* save us here: `mustFinalize` forces a `final_answer` (an **Answer**), not a `reply` — so a greeting the model decides to investigate runs queries up to the budget and then gets force-finalized into an evidence-backed Answer *about a greeting*. The budget bounds the cost but not the wrongness. Therefore the heuristic fast-path is **not optional** for the unambiguous-greeting case: before the first model call, an obvious pure-greeting / empty-ish input short-circuits to a canned `reply` (0 model calls, 0 queries). This is the only mechanism that *guarantees* the `你好` fix. Scope it tightly (only unmistakable greetings; everything else goes to the model) and gate it on the eval set: the routing-accuracy metric (§6) is the regression signal, and if tool-mediated routing scores below threshold on greetings/authoring, the heuristic expands.

---

## 4. Cancellation (interruptibility)

A turn must be stoppable, and stopping must actually stop server spend.

**Ownership note (reconciles spec 08 §2.1).** Spec 08 §2.1 already scopes AbortSignal threading, deferred to M1 because real Postgres needs `pg_cancel_backend`. This spec **pulls forward the loop-level slice** (between-steps abort + provider `fetch` cancellation — pglite needs no mid-query cancel); 08 §2.1 is amended to "loop-level cancellation delivered in spec 13; M1 adds executor-level `pg_cancel_backend` for in-flight statements." One owner per change.

Exact insertion points (most of the chain already exists; only the runner threading is missing):

- **UI** — while `status === 'streaming'`, the send button becomes a **Stop** button (keyboard-focusable, `aria-label`); clicking it calls the existing `reset()`/abort on the client `AbortController` in `useInvestigationStream`.
- **Transport** — `apps/web/app/api/investigations/route.ts` reads `req.signal` (Web `Request.signal`, fires on client disconnect — **available but currently unused**) and passes it through `askStream` → `service.ask`.
- **Runner** — `AgentRunner.run(input, { signal })` — a **breaking signature change** (`run(input)` → `run(input, opts?)`; all call sites updated). Checks `signal?.aborted` at the top of each loop iteration and threads `signal` into `provider.next(input, history, signal)` (`fetchComplete` already forwards `opts.signal` to `fetch` and checks `aborted`; remove the now-stale "AgentRunner does not thread one yet" comment in `provider.ts`) and into `executor.run`.
- **Persistence on abort** — `service.ask` creates the Investigation row *before* the run and `saveAnswer`s *after*. On abort the spec's rule is: **delete the orphan Investigation** (no answer, no message) so the store stays consistent — an aborted turn leaves no half-record. (Abort during `saveAnswer` itself is treated as completed — the write is a single tx; we don't roll back a finished answer.)
- **Stream** — emit a terminal `aborted` SSE event; the client renders the partial turn as "stopped". The `usage` frame for tokens already spent is emitted before `aborted`.

Guarantee: after Stop, **no further `run_sql` or model call is issued**, in-flight ones are abandoned, and the store has no orphan rows.

---

## 5. Input boundary (IME + commands)

`apps/web/components/composer.tsx` submits on `Enter && !shiftKey`. It must not submit while an IME composition is active (the Chinese-IME Enter that confirms candidates):

```ts
if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
  e.preventDefault();
  submit();
}
```

`keyCode === 229` covers browsers that report composition that way. Shift+Enter (newline) is unchanged. This is the smallest fix in this spec but it belongs to the harness's input boundary alongside the existing `/clear` command interception (PR #30).

---

## 6. Observability & the evaluation harness

The reactive fixes were each discovered by hand-running questions. Systematize that feedback loop.

- **Per-turn trace** *(extends usage metering)* — alongside the `usage` frame, record a structured trace: `{ intent, route, queries, modelCalls, tokens, status, repaired, retried, aborted, ms }`. Logged server-side; the cost footer already surfaces tokens/calls/queries.
- **Eval set** — `packages/core/agent/eval/` holds labeled cases: `{ question, lang, expectedRoute, expect: { status?, maxQueries?, contains? } }` spanning every intent (greeting, data-question, sql-authoring, mutation-execute, out-of-scope, meta). Routing + guardrail assertions run against the **FixtureProvider** (deterministic, in CI). An optional live pass uses explicit `EVIDATA_LIVE_MODEL_*` test env vars for end-to-end answered-rate / avg-queries / avg-tokens (hermetic CI never calls the network; app runtime still resolves real models from registered `ModelProvider` rows).
- **Metrics** — routing accuracy, answered-rate, avg queries/turn, avg tokens/turn, % repaired, % aborted. These are the harness's regression signals.

---

## 7. Guardrails preserved

**Execution boundary: unchanged.** `run_sql` is still the only DB path and still read-only behind the SafetyGate; `draft_sql` and `reply` cannot execute anything (drafted DML is text — its only "risk" is the user running it in their own DB, outside evidata's boundary). Every **Answer** is still evidence-gated (G3) and every run recorded (G4). Executing a write still hits the gate → `BlockedByPolicy` regardless of how the model framed it.

**What does change (stated plainly): the Message channel trades away G3 for non-data-claim turns.** A Message is unvalidated, so the G3 guarantee ("every claim cites evidence") does **not** hold for Message text — it holds for Answers only. This is acceptable *only* because Messages are restricted to intents that make no data claim, enforced by the layers in §1.1 (zero-query-by-construction + prompt + eval + UI). If a Message ever carries a data figure, that is a bug the eval harness must catch, not a sanctioned path. Data-source scoping (spec 12) moves from the `cannot_answer(insufficient_results)` stopgap to the friendlier `reply` decline — same effect (off-topic ⇒ 0 queries), now a Message instead of an awkward `NoReliableAnswer`.

---

## 8. Phasing & tests

- **P1 — quick UX wins.** IME composition guard (§5, incl. a test that Shift+Enter still inserts a newline); cancellation end-to-end (§4) incl. the Stop button + the breaking `run(input, opts?)` signature change. Tests: composer doesn't submit while composing; runner stops on an aborted signal (no further `next`/execute); an `aborted` SSE frame; **abort mid-run leaves the store consistent** (no orphan Investigation).
- **P2 — intent layer.** The Message plumbing union (§1.2: `AgentDecision` `message`, `RunResult`/`ask` unions, SSE `message`, reducer + bubble UI; Messages **ephemeral**, no `saveMessage`); `reply` + `draft_sql` tools + routing prompt (§3) + the unambiguous-greeting heuristic guard; route the existing scope-decline to `reply`. Tests (against the **real/tool-mediated path**, not the fixture scenario regex in `ask-stream.ts`): greeting → `reply`, 0 queries; "write a DELETE" → `draft_sql`, not executed, no block; "run a DELETE" → still `BlockedByPolicy`; data question → unchanged Answer; out-of-scope → `reply` decline; **a `reply`/Message never carries evidence and is never persisted as an Answer version**.
- **P3 — eval harness.** The labeled set + trace + metrics (§6), wired as a non-blocking CI report (fixtures, incl. the FixtureProvider step-0 Message handling from §1.2) with an env-gated live pass; the routing-accuracy metric gates whether the greeting heuristic must expand (§3).

Each phase ships as its own PR with an independent review, per the project workflow.

## 9. Open questions

- **Message persistence** — record Messages in the thread (for history/audit) or keep them ephemeral? Leaning: record minimally (no version chain, no evidence) so the thread is reconstructable.
- **`draft_sql` for writes** — show drafted DML freely (it's text), or add a soft "this is a write — here's how an Admin would run it" note? M0.5: show it with the "not executed" badge; the M2 mutation-approval flow (spec 09) is where execution of writes would ever live.
- **Heuristic fast-path** — only add the pre-model greeting short-circuit if the tool-mediated route proves unreliable in the eval set.
