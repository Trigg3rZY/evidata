# Tasks: Data Source Authoring IA

**Input**: `spec.md`, `plan.md`, `data-model.md`, `quickstart.md`

**Tests**: Include focused checks where implementation changes state handling; always verify UI in a real browser.

## Phase 1: Prototype Approval

- [ ] T001 Create prototype image or browser prototype for desktop authoring sections, mobile section selector, persistent readiness/actions, and Schema multicheck controls.
- [ ] T002 Record maintainer approval on #176/#174 or the implementation PR before writing frontend code.

## Phase 2: PR A - Sectioned Authoring Layout (#176)

- [ ] T003 Update `apps/web/components/authoring-panel.tsx` to group existing controls into General, Schema, Policy, Context, Corrections, and Members & Access.
- [ ] T004 Add desktop section navigation using existing styles and semantic buttons/links.
- [ ] T005 Add mobile section navigation that does not cover save/publish actions.
- [ ] T006 Back section state with a URL hash or search parameter so a direct link or reload restores the selected section.
- [ ] T007 Keep readiness and publish/unpublish visible or immediately reachable from every section.
- [ ] T008 Preserve existing load/save payloads and lifecycle behavior.
- [ ] T009 Verify desktop/mobile authoring navigation and URL-backed section restoration in a real browser.
- [ ] T010 Run `pnpm typecheck` and `pnpm lint`.

## Phase 3: PR B - Searchable Grouped Schema Selector (#174)

- [ ] T011 Refactor the Schema section in `apps/web/components/authoring-panel.tsx` so included-table selection is searchable and grouped.
- [ ] T012 Refactor sensitive-column selection so columns are grouped by included table and searchable.
- [ ] T013 Preserve the existing "exclude table drops its sensitive columns" behavior.
- [ ] T014 Add the smallest focused regression check for schema selection state if the logic moves into a helper.
- [ ] T015 Verify save/reload behavior for included tables and sensitive columns in a real browser.
- [ ] T016 Run `pnpm typecheck`, `pnpm lint`, and the focused authoring check.

## Phase 4: Optional QA Cleanup

- [ ] T017 Fix only browser-verified overlap, accessibility, or bilingual/theme issues that block #176/#174 acceptance.

## Dependencies

- PR A can ship independently and references #176.
- PR B depends on PR A's Schema section location and references #174.
- PR C exists only if verification finds blocking polish after A/B.

## Out of Scope

- No ER diagram (#173).
- No per-conversation Data Source picker (#175).
- No manual glossary/mapping editor (#188).
- No new UI dependency.
- No metadata migration or API payload change.
