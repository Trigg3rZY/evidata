# AI Data Portal — M0 Tech Spec

Status: Tech Spec v0.1 (M0), derived from PRD v0.3
Last updated: 2026-06-17
Language: en (engineering docs and code are English, per PRD)

This is the technical specification for **Milestone M0** of the AI Data Portal (repo: `evidata`). It is the implementation-level companion to the PRD in `../prd.en.md`. M0 builds the conversation-first trusted-answer loop end to end against the executable Sample Data Source, with no real database and no calibration authoring. M1/M2 are scoped here only as placeholders so M0 interfaces are forward-compatible.

## M0 goal (from PRD `Implementation Milestones`)

Validate the single biggest product risk: **does a trusted, evidence-backed Answer actually feel trustworthy, and does the conversation loop hold together?** Everything in M0 runs against the Sample Data Source so the team can iterate on the Answer Contract and interaction model without provisioning infrastructure.

### In scope for M0

- Conversation-first Ask Data surface: Investigation Thread, composer with in-composer Data Source selector, history rail (matches `../prototypes/prototype.html`).
- Streamed reasoning (transient steps) over SSE.
- Full Answer Contract: Status, Direct Answer, Confidence, What I Did, Key Findings, Evidence (with collapsed, Policy-bounded SQL), Assumptions, Caveats, Recommended Follow-ups, Version Metadata.
- Status × Confidence legality enforcement.
- Follow-ups that append turns and produce new Answer versions; Follow-up vs New Investigation rule.
- Unblock Path on every non-`Answered` status.
- Quick actions on an Answer (rerun, copy/hand-off; save-as-Playbook is a disabled roadmap affordance).
- Executable Sample Data Source: real SQL executed in-process (pglite), real Evidence, no external DB.
- A real SQL Safety Gate (read-only enforcement) and result Redactor — built now because they define the trust boundary, even though the Sample has no secrets.
- Bilingual (en / zh-CN) UI and light/dark themes.
- Accessibility baseline (keyboard, labels/roles, WCAG AA contrast in all four combinations).
- Deterministic `FixtureProvider` so smoke tests run with no model API key.

### Out of scope for M0 (deferred)

- Real Connections, credential storage/encryption, schema introspection (→ M1).
- The PostgreSQL adapter beyond the Connector interface (→ M1).
- Data Source calibration authoring, Glossary/Mapping `Suggested → Verified`, Policy editing UI, lifecycle, memberships, the correction loop authoring side (→ M2).
- Multi-user auth beyond a single local dev identity (→ M1 first-run bootstrap).
- Cross-Connection comparison (D1) — M0 is single Sample source; the Unblock Path is still exercised via a `Needs Clarification` scenario within the Sample.

## Stack decision

TypeScript full-stack (confirmed). Rationale: a single language across UI and server; the Answer Contract types are shared verbatim between backend producer and frontend renderer (no schema drift); self-hosting is a single Node deployable.

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + React, TypeScript | Single deployable; route handlers serve the API + SSE. Client components for the thread. |
| Styling / theme | Tailwind CSS v4 + shadcn/ui (Radix); lucide icons | CSS-var design tokens (shadcn semantic vars + layered status set); light/dark via `data-theme`. Full system in `11-m0-design-system.md`. |
| i18n | typed message catalog (en, zh-CN) | No runtime string drift; keys checked at build. |
| Server core | framework-agnostic TS modules (ports & adapters) | Domain logic does not import Next; callable from route handlers now, a Nest/worker later (M1+). |
| Metadata store | Postgres via **pglite** (embedded) in M0 | Zero external dependency in M0; same SQL dialect as the real Postgres metadata store M1 will use. Drizzle ORM. |
| Sample execution | **pglite** instance seeded with demo data | Behind the `Connector` / `QueryExecutor` interface; M1 adds a `PostgresConnector` implementing the same interface. |
| SQL safety | `pgsql-ast-parser` (deterministic parse) | Read-only / statement-type checks in the Safety Gate; never regex-only. |
| Streaming | Server-Sent Events (SSE) | One-directional reasoning stream + final answer; follow-ups are new POSTs. |
| AI provider | `AgentProvider` port; env-configured real provider + `FixtureProvider` | Provider/model never reach the client; fixtures make smoke tests hermetic. |
| Tests | Vitest (unit) + Playwright (e2e/smoke) | Smoke suite is the M0 acceptance gate. |

Everything that will differ in M1/M2 sits behind a port (interface), so M0 code is forward-compatible.

## Proposed repository layout

```
/
├─ apps/
│  └─ web/                      # Next.js app (App Router)
│     ├─ app/                   # routes + route handlers (API, SSE); globals.css tokens
│     └─ components/            # conversation UI, Answer renderer, ...
│        └─ ui/                 # shadcn components (Tailwind v4, Radix)   (spec 11)
├─ packages/
│  ├─ core/                     # framework-agnostic domain
│  │  ├─ answer-contract/       # types + JSON schema + validators  (spec 02)
│  │  ├─ agent/                 # orchestration state machine        (spec 03)
│  │  ├─ safety/                # SQL Safety Gate                     (spec 03)
│  │  ├─ redaction/             # result Redactor + bounded context  (spec 03)
│  │  ├─ evidence/              # Evidence Recorder                   (spec 03)
│  │  ├─ ports/                 # Connector, QueryExecutor, AgentProvider, ...
│  │  └─ investigation/         # Investigation/Answer/version model
│  ├─ connectors/
│  │  └─ sample/                # pglite sample adapter + seed        (spec 05)
│  ├─ db/                       # drizzle schema for metadata store
│  └─ i18n/                     # message catalogs (en, zh-CN)
├─ docs/                        # PRD, roadmap, glossary, prototype, this tech-spec
└─ tests/
   ├─ unit/
   └─ smoke/                    # M0 acceptance smoke suite          (spec 06)
```

## Spec documents

| File | Contents |
|---|---|
| `01-architecture.md` | Components, ports/adapters with TS signatures, request/data flow, trust boundary, runtime. |
| `02-answer-contract.md` | Answer Contract as TS types + JSON Schema; Status × Confidence matrix; Unblock Path; versioning. |
| `03-agent-and-safety.md` | Agent state machine, Safety Gate rules, Redactor, Evidence Recorder, Decision Boundaries → Unblock, streamed events, FixtureProvider. |
| `04-api-and-frontend.md` | SSE API surface; frontend component tree, state, i18n, theming, a11y. |
| `05-sample-data-source.md` | Demo schema, dataset, scenarios, in-memory lifecycle. |
| `06-acceptance-and-smoke-tests.md` | M0 acceptance checklist and end-to-end smoke specs (the M0 gate). |
| `07-v1-blueprint.md` | Full-V1 umbrella: system at end of V1, milestone→capability map, data-model evolution, trust boundary. |
| `08-m1-real-postgres-and-execution.md` | M1 architecture skeleton: real PostgreSQL, introspection, credentials, auth, metadata store. |
| `09-m2-calibration-publishing-and-roles.md` | M2 architecture skeleton: calibration, Suggested→Verified, Policy, lifecycle, roles, correction loop. |
| `10-m0-data-model-and-persistence.md` | M0 MetadataStore entities, contract-as-document + normalized provenance, Drizzle schema draft, Answer versioning, guardrail traceability. |
| `11-m0-design-system.md` | Visual language: Tailwind + shadcn stack, color tokens (`globals.css` draft), the Status × Confidence system, typography, density modes, component mapping, a11y. |
| `packages/core/answer-contract/src/answer-contract.ts` | Source-of-truth TypeScript types (moved out of `docs/` into the package once code landed). |
| `packages/core/answer-contract/src/answer-contract.schema.json` | JSON Schema kept in lockstep with the types (C1 schema-sync test enforces no drift). |

Depth: M0 (01–06, 10, 11) is implementation-level; M1/M2 (08, 09) are architecture-skeleton; `07` is the umbrella blueprint.

## PRD traceability (M0)

| PRD concept | M0 spec location |
|---|---|
| Answer Contract, Status × Confidence | `02-answer-contract.md`, `contracts/` |
| Interaction Model (Thread, composer, streamed reasoning, follow-up vs new) | `03-agent-and-safety.md`, `04-api-and-frontend.md` |
| Unblock Path | `02` (types), `03` (mapping), `06` (test) |
| AI Execution Boundary, Safety Gate, Redaction, Evidence Recorder | `03-agent-and-safety.md` |
| Metadata persistence, Answer versioning, Evidence/QueryRun audit | `10-m0-data-model-and-persistence.md` |
| Sample Data Source | `05-sample-data-source.md` |
| Bilingual + theme + a11y baseline | `04-api-and-frontend.md`, `11-m0-design-system.md` |
| Guardrail Signals (read-only, no secrets to provider, every finding cites evidence) | `03` (enforcement), `06` (assertions) |
