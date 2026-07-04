# Feature Specification: Data Source Authoring IA

**Feature Branch**: `001-data-source-authoring-ia`

**Created**: 2026-07-04

**Status**: Implemented

**Input**: User description: "Data Source authoring IA: split the stacked authoring page into General, Schema, Policy, Context, Corrections, and Members & Access sections; replace flat table and sensitive-column checkboxes with searchable controls; keep included tables in database/DDL or name order instead of inferred business groups; keep publish readiness/actions visible; keep the existing authoring payload and metadata schema."

## User Scenarios & Testing

### User Story 1 - Navigate Authoring Sections (Priority: P1)

An Owner/Admin editing a real Data Source can jump directly to the authoring concern they need instead of scrolling through one stacked page.

**Why this priority**: #176 is the information-architecture fix that makes every other authoring control easier to find.

**Independent Test**: Open an authorable Data Source and verify each named section is reachable from the authoring surface while readiness and publish actions remain visible.

**Acceptance Scenarios**:

1. **Given** a Draft Data Source with schema, policy, context, corrections, and members data, **When** the Admin opens authoring, **Then** the surface shows sections for General, Schema, Policy, Context, Corrections, and Members & Access.
2. **Given** the Admin is in any authoring section, **When** they review readiness or publish/unpublish state, **Then** the readiness status and lifecycle action are still visible without returning to the top of a long page.
3. **Given** a narrow viewport, **When** the Admin changes sections, **Then** the section navigation remains usable without horizontal overflow or covering primary actions.

---

### User Story 2 - Search and Select Schema Scope (Priority: P2)

An Owner/Admin working with a large schema can find tables and sensitive columns by name without relying on inferred business groupings.

**Why this priority**: #174 fixes the highest-friction control inside authoring; it should compose with the sectioned layout but can be implemented as a second PR.

**Independent Test**: Use a schema with many tables and columns; search for a table and a column, toggle inclusion/sensitivity, save, reload, and confirm the selected scope remains correct.

**Acceptance Scenarios**:

1. **Given** a schema with dozens of tables, **When** the Admin searches by table name, **Then** matching tables are visible in database/DDL order or plain name order and can be included/excluded without scanning the full list.
2. **Given** included tables with many columns, **When** the Admin searches by column name, **Then** matching columns are grouped by table and can be marked sensitive with keyboard and pointer controls.
3. **Given** a table is excluded, **When** the Admin saves the draft, **Then** sensitive-column selections from that excluded table are dropped as they are today.

---

### User Story 3 - Review Before Implementation (Priority: P3)

The maintainer can review the planned authoring IA and interactions before frontend code is written.

**Why this priority**: The issues are labeled `needs-design`, and frontend implementation should not start until the interaction model is agreed.

**Independent Test**: Review a prototype image or browser prototype that shows desktop and mobile section navigation plus the Schema selector.

**Acceptance Scenarios**:

1. **Given** the spec is ready for implementation planning, **When** frontend implementation is proposed, **Then** the proposal includes a prototype image or browser prototype for review.

### Edge Cases

- Data Source has no Schema Snapshot yet: Schema section shows the existing not-ready state and does not invent empty controls.
- Data Source has a small schema: searchable controls still work, but the page does not feel heavier than the current checkbox list.
- Data Source has no corrections or pending invites: sections show existing empty states.
- Published Data Source is edited into a not-ready state: existing auto-demotion/readiness behavior remains unchanged.
- Long table/column names, bilingual labels, and light/dark themes do not overflow controls.

## Requirements

### Functional Requirements

- **FR-001**: The authoring surface MUST be organized into independently reachable sections: General, Schema, Policy, Context, Corrections, and Members & Access.
- **FR-002**: The readiness summary and publish/unpublish action MUST remain visible or immediately reachable while editing any section.
- **FR-003**: Section state MUST be shareable or restorable through local UI state such as a URL hash or search parameter; it MUST NOT require a database field.
- **FR-004**: The Schema section MUST replace flat table and sensitive-column checkbox lists with compact searchable controls; included tables MUST NOT be grouped by inferred business scope from table names.
- **FR-005**: The Schema controls MUST preserve existing saved values for `includedTables` and `sensitiveColumns`.
- **FR-006**: Excluding a table MUST continue to remove sensitive-column selections that belong to that table.
- **FR-007**: The feature MUST keep the existing authoring API payload and metadata schema unless a later approved plan changes scope.
- **FR-008**: The feature MUST NOT add a UI dependency for the first implementation; use existing React, CSS, and native form controls.
- **FR-009**: The feature MUST be keyboard-operable and expose meaningful labels for section navigation, search, and multicheck options.
- **FR-010**: Frontend implementation MUST NOT begin until a prototype image or browser prototype is reviewed by the maintainer.
- **FR-011**: This feature MUST NOT implement #173 ER diagram, #175 per-conversation Data Source picker, or #188 manual glossary/mapping editing.

### Key Entities

- **Data Source Authoring Draft**: Existing editable authoring state returned by `/api/data-sources/:id/authoring`; no new durable fields.
- **Authoring Section**: UI-only grouping of existing authoring concerns.
- **Schema Selection State**: UI projection of existing `includedTables`, ordered by database/DDL order or plain name order.
- **Sensitive Column State**: UI projection of existing `sensitiveColumns`.
- **Readiness State**: Existing publish-readiness result and lifecycle action.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An Admin can reach General, Schema, Policy, Context, Corrections, and Members & Access from the authoring surface without scanning the full page.
- **SC-002**: On a schema with at least 50 tables, an Admin can find and toggle a named table through search without the UI inferring a business grouping.
- **SC-003**: On an included table with at least 30 columns, an Admin can find and toggle a sensitive column through search.
- **SC-004**: Saving after section navigation and schema selection produces the same authoring payload shape as today.
- **SC-005**: Desktop and mobile browser checks show no overlap between section navigation, readiness, and primary actions.

## Assumptions

- The target user is an Owner/Admin configuring a Draft or Published Data Source.
- This feature is UI/interaction work over the existing M2 authoring service.
- No data migration, new route, new durable entity, or new authorization rule is required.
- Implementation will be split into at least two PRs: sectioned layout (#176), then searchable table list plus grouped sensitive-column selector (#174).
