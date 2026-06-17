# 09 — M2: Calibration, Publishing & Team Roles (architecture skeleton)

Goal (PRD): make a real Data Source usable by a team. M2 adds the authoring side — AI-drafted context, Glossary/Mapping with `Suggested → Verified`, Policy editing, the Draft→Published→Archived lifecycle, memberships with the capability matrix, the correction-loop review side, and a minimal provider status page. After M2, V1 is feature-complete.

Skeleton depth.

## 1. New components

| Component | Package | Responsibility |
|---|---|---|
| `CalibrationService` | `packages/core/calibration` | Drives AI draft of `DataSourceContext`; manages Glossary/Mapping entries and their `Suggested → Verified` transitions. |
| `PolicyService` | `packages/core/policy` | CRUD + validation of `Policy` (read-only, scope, row limits, timeout, sensitive fields, auto-exec/confirmation rules). Already consumed by SafetyGate/Redactor since M0. |
| `PublishingService` | `packages/core/publishing` | Lifecycle Draft→Published→Archived; enforces publish-readiness checklist. |
| `MembershipService` + `authz` | `packages/core/authz` | Data Source / Connection memberships; enforces the PRD `Roles and Capability Matrix` on every service call. |
| `SuggestionService` (review) | `packages/core/suggestion` | The review side of the correction loop: Admins triage `Suggestion`s raised via the Unblock Path into Verified edits. |
| Provider status page | `apps/web` | Admin-only provider/model status + minimal config; never visible to Queriers. |

## 2. Calibration flow (AI drafts, Admin verifies)

1. Admin runs introspection (M1) → `SchemaSnapshot`.
2. `CalibrationService` asks the `AgentProvider` to draft `DataSourceContext`: overview, core entities, field explanations, relationships, sensitive-field candidates, example questions, glossary/mapping **drafts** (all `Suggested`).
3. Admin reviews; entries become `Verified` only on explicit confirmation. Only `Verified` context is fed to the agent at query time (the M0 `AgentInput.dataSourceContext` already expects verified content).
4. Policy configured; Data Source published.

This is exactly the prototype's Admin flow (connect → snapshot → semantics → policy → publish) made real.

## 3. Suggested → Verified + correction loop

- Glossary/Mapping entries carry `status: 'suggested' | 'verified'` and provenance (`ai_draft` | `querier_correction` | `admin`).
- The Unblock Path actions `notify_admin_verify` / `pick_definition(createsSuggestion)` from M0 create `Suggestion` rows. M2's `SuggestionService` lets Admins accept (→ a Verified edit, optionally triggering a rerun → new Answer version) or reject. Queriers never mutate Verified context directly (PRD invariant).

## 4. Capability matrix enforcement

`authz` implements the PRD `Roles and Capability Matrix` as the single decision point: every service method declares the capability it needs; the guard checks the caller's Connection/Data Source membership. Key invariants enforced here: Data Source Admin ≠ Connection reuse rights (needs Connection role); Queriers never see Draft or reach Connections; only Owner transfers ownership / deletes.

## 5. New data model (migrations on top of M1)

`DataSource { id, name, description, lifecycle }`, `DataSourceConnection { dataSourceId, connectionId, alias, includedTables, fieldRules }`, `DataSourceContext`, `BusinessGlossaryTerm { dataSourceId, term, definition, status, provenance }`, `EntityMapping { ..., status, provenance }`, `Policy { dataSourceId, ... }`, `DataSourceMembership { userId, dataSourceId, role: 'owner'|'admin'|'querier' }`. `Suggestion` gains `status: 'open'|'accepted'|'rejected'` + target ref.

## 6. New API surface (sketch)

| Method & path | Purpose |
|---|---|
| `POST /api/data-sources` / `PATCH` / lifecycle | Create/edit; `POST …/publish`, `…/archive`. |
| `POST /api/data-sources/:id/calibrate` | Trigger AI draft of context. |
| `POST /api/data-sources/:id/glossary` / `:termId/verify` | Manage + verify glossary. |
| `POST /api/data-sources/:id/mappings` / `:id/verify` | Manage + verify mappings. |
| `PUT /api/data-sources/:id/policy` | Configure Policy. |
| `POST /api/data-sources/:id/members` | Invite/assign roles (Admin cannot grant Owner). |
| `GET/POST /api/suggestions` / `:id/accept` / `:id/reject` | Correction-loop review. |

All capability-gated.

## 7. Publish-readiness (PRD checklist, enforced)

`PublishingService` blocks publish unless: ≥1 healthy Connection, name + description, generated Schema Snapshot, generated AI draft, Admin-confirmed basic Glossary/Mapping, configured Policy, ≥1 Owner. A Draft that fails shows exactly which prerequisites are missing (PRD `Application States` publish-readiness).

## 8. M2 acceptance additions

- An Admin completes connect → snapshot → AI draft → verify semantics → configure Policy → publish, and a Querier (separate identity) asks a question on the published source and gets an Answer with Evidence — without DB credentials or SQL.
- Capability matrix enforced: a Querier cannot see Draft sources or manage Connections; a Data Source Admin without Connection rights cannot attach a Connection.
- A Querier-raised Suggested correction appears in the Admin review queue; accepting it verifies the edit and a rerun reflects it in a new Answer version.
- Provider config/status is Admin-only and never appears in the Querier flow.

## 9. End of V1

With M2 merged, V1 satisfies the PRD `V1 Product Scope` end-to-end loop: Admin creates and publishes a controlled Data Source; a Querier asks against it; the system runs a controlled read-only Investigation; the user receives an Answer with Evidence. Roadmap Phases 2+ begin after V1 ships and the Success Measurement signals are read.
