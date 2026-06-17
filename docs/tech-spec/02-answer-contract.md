# 02 — Answer Contract (M0)

The Answer Contract is the keystone of M0: the unit the whole loop produces, renders, validates, and smoke-tests. It is defined as code in `contracts/answer-contract.ts` (source of truth) and `contracts/answer-contract.schema.json` (JSON Schema, kept in lockstep). This document explains the design and the invariants.

PRD references: `Answer Contract`, `Status × Confidence`, `Interaction Model → Follow-up vs New Investigation`, `Unblock Path`, `Answer Versioning`.

## 1. Why code-first

The PRD requires "fixing the Answer Contract as a schema and smoke-test target." We ship two artifacts that cannot drift from each other:

- `answer-contract.ts` — shared by the server (producer) and the React UI (renderer). No translation layer, no divergence.
- `answer-contract.schema.json` — validates agent output at runtime and in tests, and documents the contract for non-TS tooling.

A CI check (spec 06) asserts the two stay in sync (types → schema via `ts-json-schema-generator`, compared to the committed JSON).

## 2. Durable fields (maps 1:1 to PRD)

`Answer` carries: `status`, `directAnswer`, `confidence` + `confidenceReason` (reason **required**), `whatIDid`, `keyFindings`, `evidence`, `assumptions`, `caveats`, optional `charts`, `recommendedFollowups`, optional `unblock`, and `meta` (version metadata). See the TS file for exact shapes.

## 3. Status × Confidence matrix (enforced)

Encoded in `LEGAL_STATUS_CONFIDENCE` and enforced by `isLegalStatusConfidence` and the schema's `allOf/oneOf`:

| Status | Allowed Confidence |
|---|---|
| `Answered` | High, Medium, Low |
| `Partial` | Medium, Low, CannotDetermine |
| `NeedsClarification` | CannotDetermine |
| `BlockedByPolicy` | CannotDetermine |
| `NoReliableAnswer` | CannotDetermine, Low |

An illegal combination is a `ContractViolation` (`illegal_status_confidence`) and is rejected before persistence.

## 4. Evidence and citations

- Every `KeyFinding.evidenceIds` is a non-empty tuple (`[string, ...string[]]`) — the type system makes "a finding with no evidence" unrepresentable; `validateAnswer` also checks it at runtime (`finding_without_evidence`) and that every cited id exists (`dangling_evidence_ref`).
- `Evidence.sql` is the **Policy-bounded, as-executed** statement, not raw internal SQL (PRD D4). `redactedColumns` records what was masked for the viewer's role.
- `Evidence` binds to a single `connectorId` — one Connection per evidence item (no cross-Connection SQL).
- Charts, when present, must also cite Evidence.

## 5. Unblock Path

`UnblockPath` has `whatsMissing` (≥1 precisely-named `MissingInfo`) and `nextSteps` (≥1 `UnblockAction`). `validateAnswer` enforces that **any status other than `Answered` carries an `unblock`** (`missing_unblock_on_non_answer`); the schema mirrors this with `if/then`.

The `MissingKind` and `UnblockActionKind` enums encode the PRD's Decision-Boundary → forward-action mapping; the runtime mapping lives in `03-agent-and-safety.md`. `notify_admin_verify` (and `request_access`) set `createsSuggestion: true`, feeding the correction loop (M2 consumes the Suggested item; M0 records and acknowledges it).

## 6. Versioning and the Thread

- `Answer.meta` carries `version` (1-based, monotonic within an Investigation), `createdAfter` (what produced this version — clarification / followup / rerun / definition_correction), and `isLatest`.
- A **follow-up** appends a `Turn` and a new `Answer` version in the **same** `Investigation` (same Data Source, continued intent). A **new Investigation** is a new `Investigation` row (changed Data Source or unrelated topic). This is the PRD "Follow-up vs New Investigation" rule, realized as: append-version vs create-investigation. The heuristic that decides which lives in `03`.
- History never overwrites: all versions persist; the UI defaults to `isLatest` and offers a lightweight "previous answers" entry.

## 7. Validation entry point

`validateAnswer(answer): ContractViolation[]` runs in the `AgentRunner` before persistence (spec 03) and is reused directly by the smoke suite (spec 06). An answer with violations is never persisted or streamed as final; the runner repairs (re-prompts the provider) or downgrades to a safe non-answer with an Unblock Path.

## 8. M0 notes

- All `LocalizedText` in M0 is the resolved answer-language string; static UI chrome uses the i18n catalog (spec 04), not this contract.
- `dataSourceId` is always the Sample in M0; the field exists so M1 needs no contract change.
