# Product Glossary and Domain Model

Status: Draft checkpoint (aligned with PRD v0.2)  
Last updated: 2026-06-17  
Language: en

This document defines product terminology and the domain model. Its purpose is to constrain future PRD, roadmap, architecture, and code naming so concepts do not drift.

## Language Conventions

- Product documents use **Data Source**, with a clear definition that it is not a single database connection. It is a business-system data entry point.
- **Connection** means the underlying technical database connection and credentials.
- **Playbook** means a reusable investigation workflow.
- Code, types, comments, tests, and commit messages are English.

## Team

The default team space inside a self-hosted deployment. V1 has one Team per deployment by default, and users mostly do not need to think about it. Future versions may support multiple Teams or Workspaces.

Team answers: who belongs to this self-hosted instance or team space?

## User

A product account. Users do not have a fixed global role. The same user may have different permissions on different Connections or Data Sources.

## Connection

A Team-level technical resource that represents a database endpoint and credentials, such as `billing_prod_readonly`.

Connections can be explicitly referenced by multiple Data Sources. Credentials are stored only on the Connection and are not copied to Data Sources.

Connection owns:

- database type
- host / port / database
- credential / secret
- SSL / network configuration
- connection health
- credential rotation

## Connection Membership

A user’s management or reuse permission on a Connection.

V1 roles:

- **Owner**: creator and final responsible party; can delete, transfer, and manage Admins.
- **Admin**: can edit the connection, test it, rotate credentials, and attach the Connection to Data Sources.

There is no Querier role for Connections. Regular query users do not directly use Connections.

## Data Source

The core product object. A Data Source is the data entry point for a business system. It consists of one or more Connections and carries business context, permissions, policies, example questions, and investigation history.

Users ask questions against Data Sources, not Connections.

Data Source answers: how can this business system be safely questioned and investigated by the team?

## Data Source Connection

A reference from a Data Source to a Connection. It defines how the Connection is used within that Data Source, including:

- alias
- purpose
- included / excluded tables
- field-level rules
- sensitive field handling
- schema snapshot reference
- context notes

The same Connection may be reused by multiple Data Sources, but each Data Source may define different table and field scope, business semantics, and Policy.

## Data Source Membership

A user’s permissions on a Data Source.

- **Owner**: creator and final responsible party. Naturally an Admin. Can delete/archive the Data Source, transfer ownership, and revoke Admins.
- **Admin**: can edit the Data Source, manage context/policy/members, publish or archive, and invite Queriers.
- **Querier**: can ask questions within the authorized scope, view Answers, and view related Evidence, but cannot edit the Data Source.

## Policy

The query and display rules for a Data Source, including:

- read-only restrictions
- auto-execution conditions
- human confirmation conditions
- row limits
- table/field scope
- sensitive field redaction
- query timeout
- result retention policy

Policy is enforced by the application backend. It is not merely an AI suggestion.

## Schema Snapshot

Structured metadata captured from Connection introspection, including tables, columns, types, foreign keys, indexes, comments, and related metadata.

AI uses Schema Snapshots to understand database structure, but does not connect directly to databases.

## Data Source Context

Business context used by both AI and users, including:

- Overview
- system boundary
- questions the source is suitable for
- questions the source is not suitable for
- business notes
- common definitions

## Business Glossary

Business terms and metric definitions such as revenue, spend, refund, active account, and settlement date.

AI may generate Suggested glossary drafts. They become reliable context only after an Admin marks them Verified.

## Entity Mapping

Mappings between business entities and database structures. For example: where Customer, Campaign, or Invoice appears across connections/tables/fields, and which cross-connection keys relate them.

Entity Mapping helps AI plan investigations and explain results, but it is not a source of truth. Unverified mappings must not be treated as strong evidence.

## Question

A natural-language question from a user. A Question must be bound to a Data Source.

## Investigation

The process around a Question, including clarification, planning, SQL generation, query execution, result interpretation, follow-up, and the Answer.

## Investigation Thread

The conversational, resumable presentation of an Investigation — the primary product surface. A Thread is bound to one Data Source, holds an ordered sequence of turns (questions, transient reasoning, clarifications, durable Answers), is listed in the history rail, and persists across sessions. Continuing the same business intent in the same Thread is a follow-up; changing intent or Data Source starts a new Thread. "Investigation" is the domain object; "Investigation Thread" is how the user experiences it.

## Query

A SQL draft generated by AI. A Query may be safety-checked, reviewed, rejected, or executed.

## Query Run

A concrete SQL execution record bound to:

- Connection
- SQL
- parameters
- execution time
- row count
- status
- error
- result summary
- safety classification

## Evidence

The material supporting an Answer, including Query Runs, result summaries, data sources, time windows, filters, definitions, assumptions, and caveats.

## Answer

The deliverable output of an Investigation, and a durable, versioned artifact pinned inside the Investigation Thread (not an ephemeral chat reply). An Answer should include:

- Summary
- Key Findings
- Evidence
- Assumptions
- Caveats
- Follow-up Questions

## Answer Version

One immutable version of an Answer within an Investigation. A follow-up, clarification, rerun, or verified definition correction produces a new Answer Version in the same Thread; earlier versions remain accessible and are never silently overwritten. The UI defaults to the latest version.

## Suggested Correction

A Querier-raised dispute about a definition, mapping, or assumption used in an Answer (e.g. "spend should exclude refunds"). It is captured as a `Suggested` edit routed to the Data Source's Admins for review — it never silently changes Verified context. This is the feedback loop that turns questions into better Data Source semantics while preserving the `Suggested → Verified` discipline.

## Playbook

A reusable investigation workflow bound to a Data Source. It describes triggers, required inputs, investigation steps, allowed tools, answer format, and human confirmation points.

Playbook is similar in spirit to a coding agent skill, but the product UI should not call it a skill. It is not black-box model memory. It is a reviewable investigation workflow confirmed by the team.

V1 preserves the concept and roadmap position. A complete Playbook editor and automatic Playbook generation do not enter the V1 main path.

## Sample Data Source

An executable built-in sample Data Source using lightweight demo data. It must not require users to provision an extra sample database.

The Sample Data Source supports onboarding, demos, QA, and smoke tests. It can be hidden or deleted.

## Relationship Rules

1. One Team has many Users, Connections, and Data Sources.
2. Connection is a Team-level resource and may be explicitly referenced by multiple Data Sources.
3. Data Source references Connection through Data Source Connection.
4. Data Source Membership determines whether a user can use or manage a Data Source.
5. Connection Membership determines whether a user can manage or reuse a Connection.
6. Being a Data Source Admin does not automatically grant reuse permission for every Team Connection.
7. Queriers never directly manage Connections.
8. When the same Connection is reused by multiple Data Sources, each Data Source may define different table/field scope, business semantics, and Policy.
9. Editing or disabling a Connection must show which Data Sources are affected.
10. A Connection must be detached from all Data Sources before deletion, or only disabling/archiving should be allowed.

## Data Source Lifecycle

```text
Draft -> Published -> Archived
```

- **Draft**: visible to Owner/Admin. They can add Connections, edit business descriptions, run schema introspection, generate AI drafts, and test queries. Queriers cannot see Draft sources.
- **Published**: visible to authorized members. Queriers can select it in Ask Data and ask questions.
- **Archived**: cannot be queried anymore. Historical Answers, Query Runs, and Evidence remain preserved.

## Publish Requirements

Before publishing a Data Source, it must have at least:

- one available Connection
- Data Source name
- short business description
- generated Schema Snapshot
- generated AI draft
- Admin-confirmed basic Business Glossary / Entity Mapping
- configured Policy
- at least one Owner

