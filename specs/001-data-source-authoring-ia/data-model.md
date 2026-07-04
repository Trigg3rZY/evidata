# Data Model: Data Source Authoring IA

No durable data model change.

## Existing Durable Inputs

- `DataSource`
- `DataSourceConnection.includedTables`
- `DataSourceConnection.fieldRules.sensitiveColumns`
- `Policy`
- `BusinessGlossaryTerm`
- `EntityMapping`
- `Suggestion`
- `DataSourceMembership`
- `DataSourceInvite`
- `SchemaSnapshot`

These remain owned by the existing M2 authoring services and routes.

## UI-Only View State

- `AuthoringSection`: one of `general`, `schema`, `policy`, `context`, `corrections`, `members`.
- `SchemaSearchQuery`: transient search text for tables and columns.
- `FilteredTableList`: derived visible tables in database/DDL order or plain name order; no inferred business grouping.
- `SchemaSelectionState`: local `Set<string>` projection of `includedTables`.
- `SensitiveColumnState`: local `Set<string>` projection of `sensitiveColumns`.

## Invariants

- `includedTables` and `sensitiveColumns` keep their existing wire shape.
- Removing a table removes sensitive columns under that table before save.
- Readiness and publish/unpublish behavior stay service-owned.
- No new migration, metadata table, route, or authorization rule is introduced.
