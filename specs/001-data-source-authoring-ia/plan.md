# Implementation Plan: Data Source Authoring IA

**Branch**: `001-data-source-authoring-ia` | **Date**: 2026-07-04 | **Spec**: `specs/001-data-source-authoring-ia/spec.md`

**Input**: Feature specification from `/specs/001-data-source-authoring-ia/spec.md`

## Summary

Refactor Data Source authoring from one stacked page into sectioned authoring, then replace the Schema section's flat checkbox lists with a searchable included-table list and grouped sensitive-column controls. Keep the existing authoring payload, service, routes, permissions, and metadata schema.

## Technical Context

**Language/Version**: TypeScript 5.7, React, Next.js App Router
**Primary Dependencies**: Existing repo dependencies only; no new UI library
**Storage**: Existing evidata metadata store; no schema changes
**Testing**: Vitest for focused logic/component-adjacent checks where present; Playwright/real browser for UI verification
**Target Platform**: Self-hosted web app, desktop and mobile web
**Project Type**: Web application
**Performance Goals**: Search/filter remains responsive for dozens of tables and columns
**Constraints**: Preserve trust boundaries, authoring authz, current API payload, bilingual/light/dark support, keyboard accessibility
**Scale/Scope**: One Data Source authoring surface; implementation split across #176 and #174

## Constitution Check

Passes:

- Trust boundary unchanged: no SQL execution, credential, Answer, Evidence, QueryRun, or model path changes.
- Metadata and secrets unchanged: no new persistence and no business-data exposure.
- Minimal changes: reuse `AuthoringPanel`, existing route payload, CSS, and native controls.
- Verification matches risk: frontend implementation requires browser checks; selector state needs focused regression coverage.

## Project Structure

### Documentation

```text
specs/001-data-source-authoring-ia/
├── spec.md
├── plan.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
apps/web/components/
├── authoring-panel.tsx
├── corrections-panel.tsx
└── members-panel.tsx

apps/web/lib/
├── authoring-routes.ts
├── authoring-service.ts
└── authoring-service.test.ts

apps/web/app/api/data-sources/[id]/authoring/route.ts
```

**Structure Decision**: Keep the feature in the existing web authoring surface. Add local components/helpers only when they reduce `authoring-panel.tsx` complexity during implementation; do not create a shared UI library or package.

## Design Decisions

- Desktop uses a left section nav inside the authoring page.
- Mobile uses a compact top section selector.
- Section state uses URL hash or search params, not database state.
- Readiness and publish/unpublish stay in a persistent header or equivalent always-visible action area.
- Schema controls use existing React state, native inputs, and CSS; no combobox dependency until native controls prove insufficient.
- Search matches table names and column names case-insensitively.
- Included tables stay in database/DDL order or plain name order; do not infer business scope groups from table names.
- Data payload remains `{ includedTables, sensitiveColumns, overview, policy }` as handled by existing authoring routes.

## Data Model Delta

No durable data model change.

The feature adds only UI projections:

- `AuthoringSection`
- `SchemaSearchQuery`
- `FilteredTableList`
- `SensitiveColumnSelection`

These are local view state derived from the existing authoring draft.

## Implementation Split

- PR A: Sectioned authoring layout, readiness/action placement, desktop/mobile navigation. Refs #176.
- PR B: Searchable table list and grouped sensitive-column selector. Refs #174.
- PR C: Optional QA cleanup only if browser validation finds follow-up issues.

Frontend implementation must be preceded by a maintainer-reviewed prototype image or browser prototype.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
