# Product Roadmap Draft

Status: Roadmap v0.2 aligned with PRD v0.2  
Last updated: 2026-06-17  
Language: en

This document records phase boundaries and future extension directions. It does not replace the PRD and is not an implementation plan. Its purpose is to distinguish what is in scope now, which future extension points should remain open, and what is explicitly out of scope for the current phase.

## Roadmap Principles

1. Product before engineering.
2. Main flow before system capability.
3. Data Source and Investigation before Playbook, Report, and Monitor.
4. A feature does not enter the main UI unless it clarifies the golden path.
5. Future capabilities may get extension points, but they must not enter the V1 main path.

## Phase 1: Self-hosted AI Data Investigation

Goal: verify whether a small team can wrap business-system databases into controlled Data Sources and use AI to complete traceable data investigations.

Scope:

- Self-hosted Web App first.
- One Team per deployment by default.
- PostgreSQL first: the first real business database adapter is PostgreSQL.
- Local accounts + first-run bootstrap: the first user who completes setup becomes the initial Owner for the default Team.
- Data Source as the core product object.
- Connection as a Team-level technical resource explicitly referenced by Data Sources.
- Data Source roles: Owner / Admin / Querier.
- Connection roles: Owner / Admin.
- Data Source lifecycle: Draft -> Published -> Archived.
- Backend Direct Connection: the application backend uses stored credentials to execute controlled read-only queries.
- Separate metadata store: product metadata is not written to user business databases.
- Connection credentials are stored with application-level encryption; secret manager integration is a future extension.
- AI provider is configured through environment variables or deployment config, and provider/model/debug stay out of the main flow.
- Schema introspection and Schema Snapshot.
- Data Source Context, Business Glossary, and Entity Mapping.
- Suggested -> Verified workflow for Business Glossary and Entity Mapping.
- Low-risk read-only queries may auto-execute; high-risk, uncertain, or unauthorized queries require confirmation or are rejected.
- Answers must include Evidence.
- Conversation-first Ask Data: a resumable Investigation Thread with streamed reasoning, a history rail, follow-ups that append new turns / Answer versions, and clarification handled as a conversational turn.
- Durable Answer artifact with versioning: latest-first, lightweight previous-answers entry, no silent overwrite.
- Correction feedback loop: a Querier dispute about a definition/mapping/assumption is captured as a Suggested edit for Admin review; it never changes Verified context directly.
- Sample Data Source uses lightweight demo data and does not require users to provision an extra sample database.
- UI supports English / Simplified Chinese and Light / Dark themes.

Explicitly out of scope:

- Mutation execution.
- Cross-connection SQL joins or a virtual mega-database.
- BI dashboard builder.
- Complex IAM.
- Multi-step organizational approval workflows.
- Native desktop app.
- Monitoring and alerts.
- Plugin marketplace.
- Public SaaS multi-tenant platform.

## Phase 2: Better Data Source Calibration

Goal: make it easier for Admins to move business definitions from people’s heads into Data Sources.

Potential capabilities:

- Better AI-assisted schema explanation.
- Sensitive-field candidate detection.
- Cross-Connection entity mapping suggestions.
- Data Source quality checklist.
- Data Source preview / test questions.
- Context drift review when schema changes affect glossary or mapping entries.
- Redacted Data Source context package import/export without credentials or real data.

Boundaries:

- Still not a full data governance platform.
- Still does not treat AI-suggested context as fact.

## Phase 3: Manual Playbooks

Goal: turn successful Investigations into reusable investigation workflows.

Potential capabilities:

- Save an Investigation as a Playbook draft.
- Manually edit Playbook trigger, required inputs, steps, allowed tools, answer format, and confirmation points.
- Playbook versioning.
- Admin review before enabling or disabling Playbooks.
- Bind Playbooks to Data Sources.

Boundaries:

- AI does not automatically enable Playbooks.
- Large built-in industry template libraries are not core dependencies.

## Phase 4: Suggested Playbooks and Reuse

Goal: let the system detect repeated investigation patterns locally and suggest Playbook drafts.

Potential capabilities:

- Analyze repeated Questions and Investigations inside the self-hosted instance.
- AI suggests Playbook drafts.
- Admin review before activation.
- Playbook run history.
- Playbook-specific Answer contracts.

Privacy principle:

- Real schema, SQL, results, glossary, investigations, and playbooks from self-hosted deployments are not sent back to the product author by default.
- Future template contribution must be explicit opt-in and redacted.

## Phase 5: Investigation-derived Reports

Goal: generate shareable reports from repeated Investigations and Playbooks, not from a blank BI dashboard builder.

Potential capabilities:

- Generate shareable Reports from Saved Investigations.
- Generate stable Report structures from Playbook outputs.
- Report history.
- Promote lightweight Answer charts into report sections.
- Shareable but permission-controlled Answer / Report pages.

Boundaries:

- Not a general-purpose dashboard builder.
- Not a complex chart editor.
- Metric catalogs are not the product starting point.

## Phase 6: Monitors and Alerts

Goal: turn frequent, stable, trustworthy investigation workflows into periodic monitoring.

Potential capabilities:

- Schedule Playbook runs.
- Generate periodic reports.
- Configure anomaly conditions.
- Send notifications to Slack/email/webhook.
- Preserve Monitor evidence history.

Boundaries:

- Only based on verified Data Source Context and Playbooks.
- Not a general observability platform.

## Future: Execution Runtime Evolution

### V1 Decision: Backend Direct Connection

The self-hosted Web App backend directly uses Connections referenced by Data Sources to execute controlled read-only SQL.

### Future Extension: Worker / Agent Runtime

Query execution may move to an independent worker, queue, isolated network, or local agent for:

- isolated database network access
- long-running tasks
- stronger audit boundaries
- future hybrid / remote control plane support

### Explicit Non-goal for V1

V1 does not connect customer production databases from a cloud SaaS, does not include a remote agent, and does not include cross-environment execution scheduling.

## Future: Multi-connection and Federated Query

### V1 Decision

Support multi-Connection understanding, multi-step single-Connection queries, and AI summarization. Each SQL query runs inside one Connection.

### Future Extension

Future versions may integrate a federated query engine, warehouse, materialized snapshots, or dedicated analytics layer.

### Explicit Non-goal for V1

V1 does not provide strongly consistent cross-database querying, cross-Connection SQL joins, or global query optimization.

## Future: Native App / Desktop Companion

### V1 Decision

Self-hosted Web App first.

### Future Extension

A desktop companion may support DBA/engineer local connections, debugging, Data Source management, or offline development workflows.

### Explicit Non-goal for V1

V1 is not a DBeaver-style native SQL IDE.

## Future: Protocol and Extension Boundaries

V1 does not include a generic plugin marketplace or VS Code-style extension host, but core capabilities should be designed around stable boundaries:

- Connector Interface
- Query Executor Interface
- Agent Tool Contract
- Playbook Spec
- Theme Tokens
- I18n Message Catalog
- Data Source Package export/import

Future evaluation areas:

- MCP integration: expose this product’s capabilities to external AI tools, or connect external tools to this product.
- Desktop companion integration.
- Community starter templates.

## Future: Conversational Affordances

V1 ships the conversation-first Investigation Thread, but several AI-assistant affordances are deliberately kept out of the V1 main path and may arrive later, only if they clarify the path to a trusted Answer:

- Attaching a prior Answer or Evidence item as context for a follow-up.
- `@`-mentioning a Verified glossary term or entity in the composer.
- Invoking a saved Playbook from the composer (depends on Phase 3).
- Command palette (e.g. ⌘K) for new Investigation, Data Source switch, and history search.
- Inline chart promotion from an Answer into a Report (depends on Phase 5).

Boundary: none of these may turn the Thread into a general chatbot or expose provider/model/debug. See PRD `Interaction Non-goals`.

## Next Discussion Reminder

When roadmap discussion resumes, prioritize:

1. Whether the smallest V1 implementation slice covers the full golden path.
2. Whether the Answer Contract is stable enough to become a smoke-test target.
3. Which roadmap capabilities need data model extension points from day one, and which only need documented boundaries.
