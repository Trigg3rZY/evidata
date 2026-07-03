# Quickstart: Data Source Authoring IA

This feature is specification-only until the maintainer approves the prototype.

## Prototype Review

1. Start from the existing Data Source authoring page.
2. Produce a prototype image or browser prototype showing:
   - desktop left section nav
   - mobile section selector
   - persistent readiness/publish area
   - Schema searchable grouped table selector
   - Schema searchable grouped sensitive-column selector
3. Get maintainer approval before implementation.

## Implementation Verification

After implementation PRs:

```sh
pnpm typecheck
pnpm lint
pnpm test -- apps/web/lib/authoring-service.test.ts
```

Run real browser checks for:

- desktop authoring section navigation
- mobile authoring section navigation
- save/reload preserving included tables and sensitive columns
- excluding a table drops its sensitive columns
- no overlap between section navigation, readiness, and primary actions
