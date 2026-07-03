# Requirements Checklist: Data Source Authoring IA

**Created**: 2026-07-04
**Spec**: `specs/001-data-source-authoring-ia/spec.md`

## Completeness

- [x] User stories are prioritized and independently testable.
- [x] Scope includes #176 and #174.
- [x] Scope excludes #173, #175, and #188.
- [x] Requirements preserve the existing authoring API payload.
- [x] Requirements state no durable data model change.
- [x] Frontend prototype review is required before implementation.

## Trust Boundary

- [x] No change to SQL execution.
- [x] No change to credentials or provider payload handling.
- [x] No change to Evidence, QueryRun, Answer, or model paths.
- [x] No change to Data Source or Connection authorization.

## Verification

- [x] Browser verification is required for desktop and mobile.
- [x] Existing save behavior and sensitive-column pruning are covered.
- [x] Typecheck, lint, and focused authoring tests are named.
