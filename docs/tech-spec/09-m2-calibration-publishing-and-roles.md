# 09 — M2: Calibration, Publishing & Team Roles (as-built)

Goal (PRD): make a real Connection into a **governed, queryable Data Source** a team can use. M2 adds the authoring side — AI-drafted context, Glossary/Mapping with `Suggested → Verified`, Policy editing, the Draft↔Published lifecycle, memberships with the capability matrix, invite-token onboarding, and a provider status check. After M2, V1 is feature-complete.

**Status.** Built as a vertical slice (S1/S2/S3) then backfilled. B4 #123 shipped the correction-loop review and accept-to-rerun path; #146 and #147 closed the follow-up consistency/race fixes. V1 is feature-complete at this boundary and is in readiness/dogfood validation.

## 1. Components (as-built)

The M2 surface lives in `apps/web/lib` next to its route handlers rather than in new `packages/core/*` packages — the services are thin orchestration over the M1 `MetadataStore` ports + the existing SafetyGate/Redactor/AgentRunner, so a web-layer home kept them close to their only consumers without a premature package boundary.

| Capability | Where (as-built) | Responsibility |
|---|---|---|
| Authoring + Policy + lifecycle | `DataSourceAuthoringService` (`apps/web/lib/authoring-service.ts`, S3 #103) | Turn the per-connection draft into a published source: `getEditable`/`save` (table scope + sensitive columns + overview, validated against the captured `SchemaSnapshot`), per-source `Policy` (row limit, timeout, confirm-on-broad-scan / confirm-on-sensitive), `publish`/`unpublish` with a readiness checklist, `listAuthorable` (incl. drafts). No separate `PolicyService`/`PublishingService` — policy + lifecycle are part of authoring. |
| Calibration (AI draft) | `CalibrationService` (`apps/web/lib/calibration-service.ts`, B2 #120) | Drafts overview + glossary + entity mappings from the `SchemaSnapshot` via the configured `AgentProvider` (or a deterministic FK-derived fixture when keyless). Glossary/mappings persist as **`Suggested` / provenance `ai_draft`**; the overview is **not** persisted (it has no status field — the resolver would feed it unfiltered) and is returned for the owner to review + Save. |
| Verification (Suggested → Verified) | `VerificationService` (`apps/web/lib/verification-service.ts`, B3 #122) | `list` / `promote` / `reject` / `editGlossary`, every mutation scoped by `dataSourceId` in the store `WHERE` (an id from another source is a no-op). Only `Verified` context reaches the Ask model. |
| Capability matrix | `authz` (`apps/web/lib/authz.ts`, B1a #129) | `canDataSource(role, capability)` — the single decision point; `requireDataSourceCapability` (in `authoring-service.ts`) resolves the caller's `DataSourceMembership` role and checks the capability. Co-located with its consumers (authoring/calibration/verification/resolver). Creating a Connection bootstraps a DS owner membership; migration `0006` backfills pre-B1a sources. |
| Invite onboarding + members | `InviteService` (`apps/web/lib/invite-service.ts`, B1b #145/#148) | Single-use, expiring, **SHA-256-hashed** invite tokens (`data_source_invites`, migration `0007`) → grant a DS role, or **signup-on-redeem** (create account + session). `create` (owner-grant = owner-only), `redeem` (atomic single-use claim), `listMembers`/`removeMember` (last-owner + owner-removal guards), `listPending`/`revoke`. UI: `members-panel` + the `/invite` redeem page. |
| Published-source resolution | `PublishedDataSourceResolver` (`apps/web/lib/data-source-resolver.ts`, S2 #102) | Assembles a query runtime from a published source: `allowedTables` from scope, `sensitiveColumns` from field rules, the per-source `Policy`, and **Verified-only** context. The query gate is **Data Source membership** (`getDataSourceRole` ∧ `canDataSource(role, 'query')`). |
| Provider status | `/admin/models` "Test" (`ModelProviderService.test`, #119) | Admin-only, owner-gated reachability probe (cheap `GET /models`) so a misconfigured model is visible before a question fails. Never visible to Queriers. |
| Correction-loop review | `SuggestionService` + `CorrectionsPanel` (`apps/web/lib/suggestion-service.ts`, `apps/web/components/corrections-panel.tsx`, B4 #123) | Queriers submit corrections from blocked answers; owners/admins accept them into Verified context or reject them. Accept is head-guarded and best-effort reruns the affected Investigation. |

## 2. Calibration flow (AI drafts, owner verifies) — as-built

1. Owner introspects (M1) → `SchemaSnapshot`.
2. `CalibrationService` asks the `AgentProvider` to draft `DataSourceContext`: overview, glossary terms, entity mappings — all **`Suggested`** (the overview is returned for review, not persisted).
3. Owner reviews in the authoring panel; entries become **`Verified`** only on explicit confirmation (`VerificationService`). Only `Verified` context is fed to the agent at query time.
4. Owner sets scope + Policy and **publishes**.

This is the prototype's Admin flow (connect → snapshot → semantics → policy → publish) made real, owner/admin-gated by the capability matrix.

## 3. Suggested → Verified + correction loop — as-built

Glossary/Mapping entries carry `status: 'suggested' | 'verified'` and provenance (`ai_draft` | `admin`; `querier_correction` is reserved). The review side is implemented:

- Unblock-Path actions (`notify_admin_verify` / `pick_definition`) create `Suggestion` rows scoped to the Investigation's Data Source and submitter.
- Owners/Admins list the open queue on the Data Source authoring surface, choose the Suggested glossary term or mapping the correction applies to, then accept or reject.
- Accept promotes the chosen item to Verified (and applies the proposed glossary definition when supplied), records reviewer metadata, and triggers a best-effort rerun of the affected Investigation only if the answer version that raised the correction is still the head.
- Queriers never mutate Verified context directly.

The service is race-safe enough for V1: reviewed suggestions cannot be accepted/rejected twice, suggestion ids are scoped by Data Source, and rerun skips rather than falling back to an unintended model when a bound provider cannot resolve.

## 4. Capability matrix enforcement (as-built)

`authz` implements the PRD role matrix as the single decision point. Roles → capabilities:

| Role | Capabilities |
|---|---|
| `owner` | author, publish, view_draft, query, manage_members, transfer_or_delete |
| `admin` | author, publish, view_draft, query, manage_members |
| `querier` | query |

Invariants enforced: a Querier may only query (never sees Drafts, never reaches Connections); an Admin authors/publishes/manages members but **cannot transfer ownership or mint/remove an Owner**; only the Owner can. **Membership ≠ authorization** — a Querier is a member yet is rejected by every authoring/member service. Connection-level ops stay gated by `ConnectionRole` (a DS Admin has no Connection-reuse rights).

## 5. Data model (as-built, migrations on M1)

`DataSource { id, name, kind, connectionId, lifecycle: 'draft'|'published'|'archived' }` (only `draft`↔`published` are exposed via publish/unpublish; `archived` is reserved), `DataSourceConnection { dataSourceId, connectionId, alias, includedTables, fieldRules }`, `DataSourceContext` (+ overview), `BusinessGlossaryTerm { id, dataSourceId, term, definition, status, provenance }`, `EntityMapping { id, dataSourceId, fromRef, toRef, status, provenance }`, `Policy { dataSourceId, rowLimit, timeoutMs, statementTimeoutMs, confirmOnBroadScan, confirmOnSensitiveAccess }`, `DataSourceMembership { id, userId, dataSourceId, role }`, `DataSourceInvite { id, dataSourceId, role, tokenHash, createdBy, expiresAt, redeemedAt, redeemedBy }`, `Suggestion { id, investigationId, answerVersion, dataSourceId, submittedBy, kind, targetRef, description, proposedDefinition, status, targetKind, targetItemId, reviewedBy, reviewedAt }`. Migrations: `0006` (DS owner backfill), `0007` (invites), `0008` (correction-loop suggestion review fields).

## 6. API surface (as-built)

| Method & path | Purpose |
|---|---|
| `GET/PUT /api/data-sources/:id/authoring` | Read/save the editable draft (scope, sensitive cols, overview, policy). |
| `POST /api/data-sources/:id/lifecycle` | Publish / unpublish (readiness-gated). |
| `GET /api/data-sources/authorable` | The caller's authorable sources (incl. drafts). |
| `POST /api/data-sources/:id/calibrate` | AI-draft context (overview/glossary/mappings). |
| `GET/POST /api/data-sources/:id/context-items` | List + promote/reject/edit glossary & mappings. |
| `GET/POST /api/data-sources/:id/members` · `DELETE …/members/:userId` | List members; remove (last-owner / owner-removal guarded). |
| `GET/POST /api/data-sources/:id/invites` · `DELETE …/invites/:inviteId` | List/mint/revoke single-use invites (owner-grant = owner-only). |
| `POST /api/invites/redeem` | Redeem a token: grant to the signed-in user, or signup-on-redeem + session. |
| `POST /api/model-providers/:id/test` | Provider reachability probe (#119). |
| `POST /api/investigations/:id/suggestions` | Submit a correction from a blocked answer's Unblock Path. |
| `GET /api/data-sources/:id/suggestions` | Owner/Admin open correction queue. |
| `POST /api/data-sources/:id/suggestions/:sid` | Accept (promote to Verified + best-effort rerun) or reject a correction. |

All capability-gated in the service. Correction submission is intentionally `query`-gated so Queriers can raise unblock feedback; the Data Source queue and review routes are `author`-gated and return 404 to non-managers (no existence leak).

## 7. Publish-readiness (enforced)

`publish` blocks unless: a captured `SchemaSnapshot` exists, **≥1 included table**, and a configured `Policy`. A Draft that fails shows exactly which prerequisites are missing. Invariant: a published source is always ready/queryable — an edit that makes a published source not-ready **auto-demotes it to Draft** (S3, Codex P2).

## 8. M2 acceptance (spec 09 §8, extends `06`)

- An Owner completes connect → snapshot → AI draft → verify semantics → configure Policy → publish, and a Querier (separate identity, onboarded by an **invite link** — no email server) asks a question on the published source and gets an Answer with Evidence — **without DB credentials or SQL**.
- Capability matrix enforced: a Querier cannot see Draft sources, author, manage members, or reach Connections; an Admin can author/manage members but cannot transfer ownership or mint an Owner; a stranger has no access.
- Provider config/status is Admin-only and never appears in the Querier flow.
- A Querier-raised Suggested correction appears in the Admin review queue; accepting it verifies the edit and a rerun reflects it in a new Answer version when the raised answer is still the head.

## 9. As-built coverage (acceptance → tests)

Each shipped criterion maps to a CI-gated test (real-Postgres ones run against the CI service container / local docker-compose; otherwise hermetic):

| Criterion | Covered by |
|---|---|
| Connect → introspect → publish → **read-only query on real data**, write rejected | `data-source-resolver.integration.test.ts` (gated PG: publish a real source → resolve → SELECT returns rows; INSERT rejected by the read-only role + READ ONLY tx) |
| Multi-user trust boundary: Owner invites a Querier (signup-on-redeem) → matrix enforced across services (query ✓, authoring/members ✗); Admin manages but can't transfer/mint-Owner; stranger no access | `m2-acceptance.test.ts` (hermetic, end-to-end across `InviteService` + `authz` + `DataSourceAuthoringService` + the `PublishedDataSourceResolver` query gate via `list`/`resolve`) |
| Capability matrix (role → capability) | `authz.test.ts` (`canDataSource` for owner/admin/querier/none across all capabilities) |
| Invite lifecycle: single-use, expiry, owner-grant gating, signup-vs-logged-in redeem, last-owner / owner-removal guards, revoke | `invite-service.test.ts` |
| AI calibration drafts Suggested context (overview not persisted) | `calibration-service.test.ts` |
| Suggested → Verified promote/reject/edit, scoped per source | `verification-service.test.ts` |
| Authoring: scope validated vs snapshot, readiness-gated publish, auto-demote on not-ready edit | `authoring-service.test.ts` |
| Query gate is DS membership (member resolves; non-member / anonymous denied) | `data-source-resolver.test.ts` + the integration test above |
| Provider reachability probe (owner-gated; no key/body leak) | `model-provider-service.test.ts` (#119) |
| DS owner bootstrap on connection create; `0006` backfill | `connection-service.test.ts`, `store.test.ts` |
| Correction submit/list/accept/reject, Data Source scoping, reviewed-once guard | `suggestion-service.test.ts` |
| Accept-to-rerun is head-guarded, best-effort, and preserves no-silent-fallback for bound models | `correction-rerun.test.ts` |

The full Ask loop over a real Connection is exercised by the gated integration test (resolver → connector) and the Sample smoke gate (`06`); the correction-loop service/rerun behavior is covered hermetically.

## 10. End of V1

With M2 merged, V1 satisfies the PRD `V1 Product Scope` loop: an Owner creates and publishes a controlled Data Source; a Querier onboarded by invite asks against it; the system runs a controlled read-only Investigation; the user receives an Answer with Evidence; and the correction loop can turn a blocked-answer suggestion into Verified context plus a guarded rerun. Roadmap Phases 2+ begin after V1 readiness validation and dogfood signals are read.
