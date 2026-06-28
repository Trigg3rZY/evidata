# evidata

A self-hosted **AI Data Portal**: small teams wrap internal databases into controlled
**Data Sources**, members ask questions in natural language, and get trusted,
evidence-backed **Answers**. The AI proposes; the application validates, executes
(read-only), redacts, and records.

> **AI proposes, the application controls.** The model never touches the database.
> Every step between the model and the data — Safety Gate, executor, redactor,
> evidence recorder — is deterministic application code.

## Status

V1 is feature-complete at the M2 boundary and is entering validation/dogfood.
The current focus is freshness of docs, fresh-install verification, and real or
semi-real database trials before choosing the next roadmap slice.

- **PRD** (v0.3, bilingual): [`docs/prd.en.md`](docs/prd.en.md) · [`docs/prd.zh-CN.md`](docs/prd.zh-CN.md)
- **Tech spec** (M0/M1/M2 as-built): [`docs/tech-spec/`](docs/tech-spec/)
- **V1 readiness checklist**: [`docs/v1-readiness.md`](docs/v1-readiness.md)
- **Interactive UI prototype**: [`docs/prototypes/prototype.html`](docs/prototypes/prototype.html)

## Milestones

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Conversation-first trusted-answer loop end-to-end against an executable Sample Data Source (in-process pglite, no real DB). | Built |
| **M1** | Real PostgreSQL connections, credential storage, schema introspection, controlled execution. | Built |
| **M2** | Data Source calibration, Suggested→Verified publishing, Policy, roles, correction loop. | Built |

## Stack

TypeScript full-stack — Next.js (App Router) + React, framework-agnostic core
(ports & adapters), pglite + Drizzle, `pgsql-ast-parser` for the SQL Safety Gate,
SSE streaming, Vitest + Playwright.

## Development

Requires Node `>=22` and pnpm (see [`package.json`](package.json) `packageManager`).

```sh
pnpm install
pnpm typecheck   # tsc
pnpm test        # Vitest unit tests
pnpm e2e         # Playwright smoke suite (M0 acceptance gate)
pnpm --filter @evidata/web dev
```

Repository layout is described in [`docs/tech-spec/README.md`](docs/tech-spec/README.md).

## Contributing workflow

`main` is protected: all changes land via PR with **rebase merge** only (linear
history). Branch → commit → push → open PR → CI green → `gh pr merge --rebase --delete-branch`.
