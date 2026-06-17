# AI Data Portal PRD

Status: PRD v0.3 reviewable draft  
Last updated: 2026-06-17  
Language: en

This document captures the first product definition for the next product experiment. It is not an implementation plan or final interaction/technical specification. Its purpose is to define positioning, users, boundaries, golden path, core objects, and acceptance criteria as stable input for implementation planning.

> **v0.2 revision note.** This revision adopted a conversation-first, AI-era interaction model (in the spirit of modern AI assistants such as Claude Desktop), while keeping every trust and safety boundary intact: a new `Interaction Model` section that makes the **Investigation Thread** a first-class surface; a clarified follow-up-vs-new-investigation rule; a **correction feedback loop** that turns Querier disputes into Suggested glossary/mapping edits for Admins; an **Unblock Path** that makes every non-answer actionable; an explicit Status × Confidence matrix; and lightweight quick-actions/command affordances. A reviewable low-fidelity prototype lives at `prototypes/prototype.html`.
>
> **v0.3 revision note (development-ready).** This revision closes the gaps needed to begin tech-spec work: a `Success Measurement and Validation Signals` section (guardrail + value + anti-signals and a continue/iterate/pivot/stop rule, all within the self-hosted privacy boundary); a `Roles and Capability Matrix`; an `Application States and Errors` catalog for non-happy-path product behavior; `Implementation Milestones` (M0/M1/M2) that slice V1 into independently demoable steps; and an accessibility baseline. It also records recommended decisions for the two previously-open product questions — `Cross-Connection Comparison Scope` (D1) and `Evidence Redaction and Visibility` (D4) — leaving only their mechanics to the tech spec. `product-next` is a standalone product that will live in its own repository; it does not inherit the parent `docs/` files. None of these additions change the safety model: AI still proposes, the application still controls.

## Product Positioning

Short positioning:

> A self-hosted AI Data Portal for small teams: connect databases, calibrate business semantics, and use conversation to complete trusted data investigations.

Formal product goal:

> Help small teams wrap internal databases into controlled AI data sources so members can obtain trusted, traceable data answers through conversation without receiving database credentials or being fluent in SQL.

This product is not an AI-powered DBeaver clone and not lightweight BI. Its core value is helping a small team turn database connections, business semantics, access policies, and query evidence into a safe AI-assisted data investigation entry point.

## Product Goals

1. Let small teams safely connect internal databases in a self-hosted environment without distributing database credentials to every data requester.
2. Organize one or more database connections into business-system-oriented Data Sources instead of exposing raw connections and table structures as the primary user model.
3. Let Admins use an AI-assisted workflow to calibrate Data Source business semantics, including business descriptions, entity mappings, field explanations, definitions, and limits.
4. Let Queriers ask business questions in natural language within their authorized scope and receive Answers with evidence.
5. Preserve SQL, data sources, parameters, assumptions, limits, and result summaries for every Investigation so answers can be reviewed, handed off, and reused later.
6. Leave product and technical extension points for future Playbooks, Reports, and Monitors without letting them distract from the V1 main path.

## Target Users

### V1 Primary Design Target: Technical Data Request Handlers

V1 primarily serves people who frequently answer data questions or investigate customer and business-object issues:

- Product Engineer
- Full-stack Engineer
- Support Engineer / Customer Success Engineer
- Technical Operator

They usually understand the business system and have some database literacy, but they do not want to hand-write SQL for every request or distribute database credentials to teammates. They often need to answer ad hoc questions around customers, accounts, orders, campaigns, invoices, and similar business objects.

### Data Source Owner / Admin

People with database access are responsible for wrapping a business system into a usable Data Source:

- Create and manage database Connections.
- Calibrate Data Source Context.
- Configure query boundaries and redaction rules.
- Invite team members to use the Data Source.

### Supported but Not Primary in V1: Business, Ops, and Product Teammates

Business, operations, and product teammates may use well-curated published Data Sources as Queriers. V1 does not primarily design for fully non-technical users. Their priority can increase in the roadmap after Data Source Context, Business Glossary, Playbooks, and Answer trust mechanisms mature.

### Secondary Users

- DBA / Platform Engineer: cares about connection safety, read-only access, auditability, and query cost, but V1 is not a DBA management suite.
- Engineering Manager: cares about reviewable answers and team investigation knowledge, but is not the daily primary operator.

## Core Pain Points

1. **Object-level investigations are hard to start quickly**  
   Technical data handlers often need to answer questions about specific business objects but do not know which Data Source, tables, fields, or definitions are authoritative.

2. **Existing SQL client workflows are hard to hand off**  
   Engineers and support staff write SQL in a SQL client, take screenshots, and copy results to business teammates. SQL, parameters, filters, assumptions, and caveats are difficult to review or reuse.

3. **Database access and data needs are misaligned**  
   Business, ops, and product teammates need answers, but should not receive database credentials. Teams need a read-only, authorized, redacted, cost-limited data investigation entry point.

4. **AI-generated SQL is not the same as a trusted answer**  
   AI can generate SQL and explanations, but without business semantics, policies, safety checks, controlled execution, and evidence, answers cannot be trusted or handed off.

5. **Business definitions and investigation experience do not accumulate well**  
   Important small-team definitions often live in people’s heads: status meanings, soft-delete rules, refund fields, time semantics, cross-database IDs, and repeated investigation paths.

## Product Principles

1. **Ask first, inspect when needed**  
   Users start from questions, not schema trees or SQL editors. SQL is always inspectable but not always blocking.

2. **Data Source over Connection**  
   Users ask questions against Data Sources. Connections are technical resources and should not become the Querier’s primary mental model.

3. **AI proposes, app controls**  
   AI proposes plans and SQL. The application validates, authorizes, executes, redacts, records, and produces evidence.

4. **Business semantics are verified, not assumed**  
   AI may suggest glossary and entity mapping drafts, but Admin confirmation is required before they become reliable context.

5. **Every answer needs evidence**  
   Every Answer must explain what was queried, how the conclusion was reached, and what assumptions or uncertainties remain.

6. **Start from investigations, grow into insights**  
   V1 focuses on investigations around specific business objects. Reports, Monitors, and dashboard-like views should grow from repeated Investigations and Playbooks.

7. **Product surface stays simple**  
   A feature does not enter the main UI unless it clarifies the golden path. Engineering concepts such as provider, session, fixture, debug, and artifact stay out of the main flow.

8. **Self-hosted trust boundary**  
   Schema, SQL, results, business definitions, Investigations, and Playbooks remain inside the self-hosted deployment by default.

9. **Launch with bilingual UI and light/dark themes**  
   V1 UI supports English and Simplified Chinese, plus light and dark themes. Code, comments, tests, and commit messages remain English.

10. **Conversation is the surface, the Answer is the artifact**  
    The primary surface is a resumable Investigation Thread, not a form. Users ask, refine, and follow up in a continuous conversation; each trusted Answer is a durable, versioned artifact pinned inside that thread. This is what makes the product feel like a modern AI tool rather than a query form — without turning it into an unbounded chatbot.

11. **Agentic but inspectable, never noisy**  
    The agent may stream its reasoning, propose a plan, and pause for confirmation on risky steps, like a good AI assistant. But transient reasoning is progressive disclosure, not the deliverable: it collapses into `What I Did` once done. Engineering internals (provider, model, raw tool payloads, debug traces) never surface in the thread.

## Non-goals

1. It is not a SQL IDE or DBeaver replacement. SQL is inspectable, but schema trees, SQL editors, and multi-tab manual querying are not the primary entry point.
2. It is not a BI dashboard builder. V1 does not provide dashboard creation, metric catalogs, chart editors, or scheduled reporting workflows. Charts may appear only as supporting elements inside an Answer.
3. It is not a data warehouse, ETL system, or federated query engine. V1 does not move business data, create virtual cross-database tables, or promise cross-connection SQL joins or strongly consistent cross-database analysis.
4. It is not a public SaaS platform. V1 targets small-team self-hosting and does not include public signup, commercial multi-tenancy, billing, or cloud-hosted connections to customer production databases.
5. It is not an unlimited natural-language data interface for everyone. Users can ask questions only within authorized Data Sources.
6. V1 does not execute mutations or database administration operations. It may generate mutation SQL drafts and risk notes, but cannot execute them in the product.
7. AI does not directly access databases, hold credentials, or expand permissions. AI only proposes plans, SQL, or tool calls. The backend validates, authorizes, executes, redacts, and records.
8. AI-generated business semantics are not automatically facts. Business Glossary and Entity Mapping entries are Suggested until an Admin verifies them.
9. Schema, SQL, results, business definitions, Investigations, and Playbooks from self-hosted deployments are not uploaded to the product author by default.
10. V1 does not include complex IAM, multi-step organizational approval workflows, a native desktop app, monitoring/alerts, or a plugin marketplace. These belong in the roadmap.

## Golden Path

1. **Admin creates a Data Source**  
   An Admin creates a Data Source such as `Advertising Platform`, representing the data entry point for a business system.

2. **Admin attaches one or more Connections**  
   The Admin creates or reuses existing Connections and tests connectivity. Connections are Team-level technical resources, and Data Sources reference them.

3. **System introspects schema**  
   The backend reads schema metadata and produces a Schema Snapshot. AI does not connect directly to the database.

4. **AI drafts Data Source Context**  
   AI uses schema metadata and Admin-provided business descriptions to draft a system overview, core entities, field explanations, relationships, sensitive-field candidates, and example questions.

5. **Admin verifies context and policy**  
   The Admin verifies Business Glossary and Entity Mapping entries, then configures Policy such as read-only limits, row limits, sensitive fields, auto-execution rules, and confirmation rules.

6. **Admin publishes the Data Source**  
   The Data Source moves from Draft to Published. Only authorized Owners, Admins, and Queriers can see and use it.

7. **Querier asks a question**  
   In Ask Data, the Querier selects a Data Source and asks a natural-language question such as “Why is ACME’s ad bill higher this month than last month?”

8. **Agent runs a controlled investigation**  
   The agent uses Data Source Context, Verified mappings, and Policy to create an investigation plan. Low-risk read-only queries may run automatically; high-risk, uncertain, or unauthorized requests require confirmation or are rejected.

9. **System returns an Answer with Evidence**  
   The Answer contains the conclusion, key facts, data sources, SQL/evidence, assumptions, limits, uncertainty, and suggested follow-up questions.

10. **Investigation is saved for review and reuse**  
    The Investigation saves the Question, plan, Query Runs, Evidence, Answer, and caveats. Later it can support review, handoff, or Playbook creation.

## User Stories

### Owner

- As an Owner, I want to create a Data Source that wraps a business system’s data connections, business semantics, and access boundary.
- As an Owner, I want to invite Admins and Queriers so team members can use the same Data Source with different permissions.
- As an Owner, I want to manage the Data Source lifecycle: Draft, Published, Archived.
- As an Owner, I want to see what questions were asked, what queries ran, and whether there were risks.
- As an Owner, I want to transfer ownership or revoke Admins so final responsibility remains controlled.

### Admin

- As an Admin, I want to create or reuse database Connections and test connectivity.
- As an Admin, I want AI to scan schema metadata and draft business entities, field explanations, sensitive fields, and relationships.
- As an Admin, I want to add business descriptions and verify or edit Business Glossary and Entity Mapping entries.
- As an Admin, I want to configure Data Source Policy, including read-only access, row limits, sensitive fields, auto-execution, and confirmation rules.
- As an Admin, I want to test sample questions before publishing to check whether Answers are trustworthy.
- As an Admin, I want to maintain Data Source context so AI answers become more stable over time.

### Querier

- As a Querier, I want to open the product and see the Data Sources I can use.
- As a Querier, I want to select a Data Source and ask a business question in natural language.
- As a Querier, I want to receive answers without receiving database credentials or writing SQL.
- As a Querier, I want to inspect the investigation plan, SQL, and data sources when needed.
- As a Querier, I want to understand the assumptions, definitions, and uncertainty behind an answer.
- As a Querier, I want to ask follow-up questions, review previous Investigations, or hand off an Answer to business teammates.

### First-run / Sample

- As a new user, I want to try a Sample Data Source before connecting a real database so I can understand the product value quickly.
- As an Admin, I want to use the Sample Data Source as a reference for what a well-configured Data Source looks like.
- As a developer or maintainer, I want to use the Sample Data Source for smoke tests that verify the Ask Data to Answer flow.

## Navigation and First Screen

V1 primary navigation has only two mental entry points:

1. **Ask Data**: users select an authorized Data Source and ask a question.
2. **Data Sources**: Owners and Admins create, configure, calibrate, publish, and manage Data Sources. Queriers may view the Data Source overview and example questions for sources they can use, but cannot edit them.

Not V1 primary navigation:

- Dashboard / Insights
- Playbooks
- Approvals
- Audit Logs
- Connections
- Provider Settings
- Debug
- Sessions
- Artifacts

On first deployment with no real Data Source, the first screen should show product value before configuration complexity. It should include only:

- One-line positioning: `Self-hosted AI Data Portal for trusted data investigations`
- Primary button: `Try Sample Data Source`
- Secondary button: `Create Data Source`
- 2-3 sample questions
- Brief safety notes: database credentials stay in this instance; AI does not execute SQL directly; queries are checked and executed read-only by the backend

After the user has accessible Data Sources, the default home is a **conversation-first Ask Data surface**. On an empty state it shows a centered composer with a greeting, the Data Source selector living inside the composer, 3-4 sample questions, and a Recent Investigations area. Once the user asks, the surface becomes an Investigation Thread (see `Interaction Model`). A history rail of recent Investigations is a primary, persistent surface; Data Sources and settings are secondary entries.

## Interaction Model

This section defines the AI-era interaction model: how questions, reasoning, answers, follow-ups, and corrections behave as a continuous experience. It refines — and does not replace — the Answer Contract and Architecture Boundaries. The guiding reference is a modern AI assistant (resumable threads, streamed reasoning, durable artifacts, inline citations), constrained by this product's trust model.

### Investigation Thread

The Investigation is a **first-class, resumable conversational thread**, not a one-shot transaction.

- A Thread is bound to exactly one Data Source for its lifetime. To investigate a different business system, the user starts a new Thread.
- A Thread contains an ordered sequence of turns: user questions, transient reasoning, clarifications, and durable Answers (each a versioned artifact).
- Threads are listed in a history rail (e.g. grouped Today / Earlier), are openable, resumable, and renamable, and persist across sessions.
- Opening a Thread restores its latest Answer and the path that produced it. History must never be silently overwritten.

### Composer

The composer is the single entry point for asking and following up, and it carries lightweight context — never engineering noise.

- The **Data Source selector lives inside the composer** as a pill, so the active source is always visible and switchable, but the source is never the primary mental model.
- The composer is reused in two places: centered on the empty state, and docked at the bottom of an active Thread.
- Submitting from the composer appends a new turn to the current Thread (it does not replace the previous Answer).
- Roadmap affordances (kept out of the V1 main path but designed for): attaching a prior Answer or Evidence item as context for a follow-up; `@`-mentioning a Verified glossary term or entity; invoking a saved Playbook from the composer.

### Streamed Reasoning (transient)

While an Investigation runs, the agent may stream progress as ordered steps (resolving the business object, generating read-only SQL, running a query, summarizing). This aligns with the `Transient Investigation Updates` rules: steps show while active, collapse into `What I Did` when done, and stay visible if a step fails, is blocked by Policy, or needs clarification. Streamed reasoning is presentation, never the deliverable, and never exposes provider/model/raw payloads.

### Answer as a Durable Artifact

Each trusted Answer is a durable, versioned artifact pinned inside the Thread, following the full Answer Contract. It is the unit that gets reviewed, handed off, and (later) promoted into a Playbook or Report. Inline citations (Key Finding → Evidence reference, e.g. `E1`) let a reader jump from a claim to its supporting Query Run.

### Follow-up vs New Investigation

This resolves a previously open question and governs both history and versioning:

- A **follow-up** continues the same Thread and the same business intent — a refinement, drill-down, clarification answer, definition correction, or rerun. A follow-up appends a new turn and produces a **new Answer version** within the same Investigation. Earlier versions remain accessible via a lightweight "previous answers" entry.
- A **new Investigation** starts when the user changes business intent or Data Source. It is a fresh Thread with its own history entry.
- Heuristic for V1: same Data Source + continues the prior topic ⇒ follow-up (new version); different Data Source or unrelated topic ⇒ new Thread. When genuinely ambiguous, the agent asks before forking.

### Clarification as a Conversational Turn

`Needs Clarification` is a turn in the conversation, not a dead end. The agent states what it needs (e.g. a missing time range or which of two definitions to use) and offers concrete choices the user can pick inline. Answering a clarification is a follow-up that yields the next Answer version.

### Correction & Feedback Loop

When a Querier disputes a definition, mapping, or assumption used in an Answer (e.g. "spend should exclude refunds"), the product captures it as a **Suggested** edit routed to the Data Source's Admins for review — it never silently changes Verified context. This closes the gap where a Querier's question is the fastest signal that the Data Source's semantics are incomplete, and it keeps the `Suggested → Verified` discipline intact. Admin verification of such a suggestion can trigger a rerun that produces a new Answer version.

### Unblock Path (forward path on non-answers)

A non-`Answered` status is never a dead end. Whenever the agent clarifies, refuses, or returns an unreliable state (see `Decision Boundaries`), the Answer must carry two things: **What's Missing** — the specific blocker named precisely (which glossary term, which unverified mapping, which missing time range, which authorization, or which ambiguous definition) — and **How to Move Forward** — one or more concrete next actions the user can take inline. This turns honesty into usefulness and avoids the "the AI is dumb" perception when calibration lags.

Each Decision Boundary trigger maps to a forward action:

| Trigger | What's missing | Forward action |
|---|---|---|
| Unclear business object | which entity / record | ask to specify, or pick from candidates |
| Missing time range | a time window | inline range picker, or a suggested default |
| Unauthorized table/field | access scope | explain scope; (roadmap) request access routed to Admin |
| Mutation required | n/a (read-only) | offer a mutation SQL draft + risk notes, never execute |
| Multiple plausible definitions | which definition | pick one inline; optionally save the choice as a Suggested glossary edit |
| Cross-Connection without Verified mapping | a Verified mapping | "notify Admin to verify" → creates a Suggested mapping for review |
| Results don't support a conclusion | a narrower / alternative question | suggest a refined question |

The "notify Admin / request verification" actions reuse the Correction & Feedback Loop mechanism: they create `Suggested` items for Admins and never change Verified context directly. When an Admin resolves the blocker, a rerun can produce the next Answer version. The Unblock Path must stay lightweight (a "What's Missing" line plus a small set of action buttons) and must not turn a refusal into a wall of configuration.

### Quick Actions on an Answer

A small, consistent action set sits on each durable Answer, keeping the surface clean: rerun (produces a new version), copy/hand-off (a shareable, permission-respecting summary for a business teammate), and — as roadmap — save as Playbook. Quick actions must not crowd out reading the conclusion.

### Keyboard & Command Affordances

Lightweight, additive, and never required: a command entry (e.g. ⌘K) to start a new Investigation, switch Data Source, or search Thread history. These are accelerators for the conversation-first model and must not introduce a separate power-user surface that competes with Ask Data.

### Interaction Non-goals

The conversation-first model does **not** make this a general chatbot. It is still bounded by authorized Data Sources, the Safety Gate, and the Answer Contract. Specifically: no free-form chat outside a Data Source, no unbounded multi-tool autonomy without confirmation on risky steps, no exposure of provider/model/debug in the thread, and no replacing durable Answers with ephemeral chat replies.

## Prototype Discussion Rule

For product-facing feature surfaces, discuss a low-fidelity web prototype before implementation. A prototype may be a temporary HTML/CSS page, text wireframe, flow diagram, or screenshot. When layout, density, states, language variants, light/dark themes, or responsive behavior matter, prefer a web prototype.

Approved prototypes should be committed to the repository as implementation references. Repository artifacts may include:

- prototype HTML source
- representative screenshots
- short product notes
- linked PRD section

Prototypes define information hierarchy, interaction states, and product intent. They are not final visual designs and should not be treated as production code.

A reviewable low-fidelity prototype for the conversation-first model is committed at `prototypes/prototype.html`. It is a single self-contained HTML file covering the first-run/empty state, the conversation-first Ask Data surface (composer with in-composer Data Source selector, streamed reasoning, durable Answer with collapsed SQL/evidence, follow-ups that append new turns), the Data Sources list/overview, and the Admin calibration/policy/publish flow. It supports English/Chinese and light/dark toggles. It encodes information hierarchy and interaction states only; it is not final visual design.

## UI Failure Criteria

The UI is failing if:

1. A first-time user cannot tell within 10 seconds that they should select a Data Source and ask a question, or create a Data Source.
2. Internal concepts such as provider, session, artifact, fixture, debug, or review decision are more prominent than Ask Data.
3. Users think this is a SQL IDE and that they must browse schema, open a SQL editor, and hand-write SQL before starting.
4. Users think this is BI and that they must create a dashboard, metric, or chart before starting.
5. Queriers must understand Connection, Policy, or Entity Mapping before asking a question.
6. Admins must complete complex data-governance modeling before creating a usable Data Source.
7. Answers provide conclusions without SQL/evidence, data sources, definitions, assumptions, and uncertainty.
8. Every local feature works, but the golden path “create controlled Data Source -> ask question -> receive Answer with Evidence” is buried.
9. The main flow has overflow, overlap, or poor contrast in any English/Chinese or light/dark combination.
10. Charts, debug, history, settings, or other secondary features steal focus from the main question flow.
11. The thread degrades into a general chatbot: durable Answers are replaced by ephemeral chat replies, follow-ups lose their Evidence/Assumptions, or the agent free-forms outside the selected Data Source's authorized scope.

## Answer Contract

An Answer is the current deliverable result of an Investigation. It is not a chat reply and not a full BI report. It must help the user answer three questions:

1. What is the conclusion?
2. What data supports that conclusion?
3. How much should I trust it?

### Durable Answer Fields

1. **Status**  
   Every Answer must have an explicit status:

   - `Answered`
   - `Partial`
   - `Needs Clarification`
   - `Blocked by Policy`
   - `No Reliable Answer`

   For any status other than `Answered`, the Answer must include a **What's Missing** statement and at least one concrete **Next Step** (see `Interaction Model → Unblock Path`). A non-answer that only states a conclusion cannot be reached is incomplete.

2. **Direct Answer**  
   A one-sentence direct answer to the user’s question. If the question cannot be fully answered, the Answer must clearly say that it is partial or not reliable.

3. **Confidence**  
   Use semantic levels, not percentages:

   - `High`
   - `Medium`
   - `Low`
   - `Cannot Determine`

   Confidence must include a reason. Example: `Medium confidence because spend and invoice data come from separate Connections and invoice timing may lag usage events.`

   **Status × Confidence.** Status and Confidence are independent dimensions and must be combined consistently:

   | Status | Allowed Confidence | Notes |
   |---|---|---|
   | `Answered` | High / Medium / Low | A complete answer may still be Low confidence (e.g. approximate cross-Connection reconciliation); the reason must say why. |
   | `Partial` | Medium / Low / Cannot Determine | Some sub-questions answered; never claim High overall. |
   | `Needs Clarification` | Cannot Determine | No conclusion yet; it is a conversational turn awaiting input. |
   | `Blocked by Policy` | Cannot Determine | Execution was refused by the Safety Gate / Policy; no data-backed conclusion. |
   | `No Reliable Answer` | Cannot Determine / Low | Data does not support a conclusion. |

   `Answered` + `High` requires complete, single-source-of-truth evidence with no material unverified assumptions.

4. **What I Did / Investigation Steps**  
   A short explanation of the investigation path, such as resolved customer identity, compared billing periods, checked campaign spend, and checked invoices and adjustments. It may be collapsed by default, but must remain durable.

5. **Key Findings**  
   Each finding must reference at least one Evidence item. Content without Evidence must not be presented as a factual conclusion. Findings may reference charts.

6. **Evidence**  
   Each Evidence item includes:

   - purpose
   - Data Source
   - Connection
   - tables
   - Query Run
   - result summary
   - SQL, collapsed by default
   - execution metadata
   - policy notes

7. **Assumptions & Definitions**  
   Explain the time window, filters, metric definitions, status enum meanings, join keys, and which Verified Business Glossary / Entity Mapping entries were used.

8. **Caveats / Uncertainty**  
   Explain data gaps, unverified mappings, cross-Connection aggregation limits, definition differences, truncation/redaction, and places requiring human confirmation.

9. **Charts**  
   Optional. Charts are supporting Answer expressions, not dashboards. Charts must reference Evidence. V1 only supports automatically generated table, bar, line, and simple comparison charts, with no chart editor.

10. **Recommended Follow-ups**  
    Provide 2-3 natural follow-up questions to help the user continue the investigation.

11. **Version Metadata**  
    Includes answer version, created at, created after which clarification/follow-up, and latest/current marker.

### Evidence Rules

- SQL is collapsed by default, but Evidence must be visible, traceable, and expandable.
- Every Key Finding must reference at least one Evidence item.
- Evidence may include SQL, result summaries, execution time, row count, redaction status, safety classification, and Policy notes.
- Query Runs and Evidence should be bound to a specific Answer version, not only to the whole Investigation.

### Answer Versioning

The underlying model should support multiple Answer versions per Investigation. Each clarification, follow-up, rerun, or definition correction may produce a new Answer version. See `Interaction Model → Follow-up vs New Investigation` for the rule that distinguishes a new version (same Thread) from a new Investigation (new Thread).

The V1 UI defaults to the latest Answer and provides a lightweight entry to previous answers. Historical Answers must not be silently overwritten.

### Transient Investigation Updates

The product may show temporary progress updates while an Investigation is running, but they are not the Answer. Examples:

- identifying the customer
- generating read-only SQL
- running a billing query
- summarizing results

Display rules:

- Show while the current step is active.
- Disappear or collapse when the process advances.
- Collapse into `What I Did` after completion.
- Stay visible if a step fails, is blocked by policy, or requires user clarification.
- Do not show provider names, raw tool payloads, debug traces, or other internal details.

### Decision Boundaries

AI should not directly provide an Answer, and should instead clarify, refuse, or return an unreliable-answer state when:

1. The business object is unclear.
2. A critical time range is missing.
3. The question requires unauthorized tables or fields.
4. The request requires a mutation.
5. Multiple plausible definitions would produce different answers.
6. Cross-Connection relationships lack Verified mapping.
7. Query results do not support a conclusion.

In every one of these cases the result must follow the `Unblock Path`: name what is missing and offer a concrete next step, rather than ending the conversation.

## Success Criteria

1. **10-second comprehension**  
   A new user can understand within 10 seconds that they can select a Data Source and ask a question, or create a Data Source; they do not mistake the product for a SQL IDE or BI dashboard.

2. **Controlled Data Source creation**  
   An Admin can create a Data Source, connect at least one database, generate a Schema Snapshot, and complete basic business context calibration.

3. **Authorized questioning**  
   A Querier can ask questions against an authorized Data Source without receiving database credentials or writing SQL.

4. **Trusted Answer**  
   An Answer must include Direct Answer, Key Findings, Evidence, Assumptions, Caveats, Confidence, and Follow-ups.

5. **Reviewable Evidence**  
   Every Key Finding references at least one Evidence item. SQL is collapsed by default but expandable.

6. **AI cannot bypass controls**  
   AI cannot directly execute SQL, access credentials, bypass Data Source Policy, or expand permissions automatically.

7. **The system knows when not to answer — and shows the way forward**  
   When the business object, time range, permission, Verified mapping, or supporting data is missing, the system clarifies, refuses, or returns No Reliable Answer instead of inventing certainty. Every non-answer names what is missing and offers a concrete next step (see `Interaction Model → Unblock Path`), so honesty stays useful.

8. **The main UI does not expose engineering noise**  
   The first screen does not show internal concepts such as provider, session, artifact, fixture, debug, or review decision.

9. **Bilingual and theme support works**  
   The main flow remains readable without overflow or overlap across English / Chinese and Light / Dark combinations.

10. **Sample Data Source verifies the main flow**  
    Without connecting a real database, a user can complete Ask Data -> Investigation -> Answer with Evidence using the Sample Data Source.

## Failure Criteria

1. Users think it is a SQL IDE.
2. Users think it is a BI dashboard builder.
3. Users must understand Connection / Policy / Entity Mapping before asking a question.
4. Answers provide only natural-language conclusions without Evidence.
5. AI invents certainty for uncertain questions.
6. Admin Data Source creation feels like a full data-governance platform.
7. Debug/internal controls are more prominent than the main path.
8. Similar questions cannot be reviewed, handed off, or used as future Playbook material.

## Success Measurement and Validation Signals

V1 is a product experiment: it validates whether a small team can wrap business databases into controlled Data Sources and get trusted, reusable answers through conversation. The Success Criteria above are pass/fail capability checks; this section defines how we know the product is actually *working* once those capabilities exist, and what would make us continue, iterate, pivot, or stop.

### Measurement Boundary

Measurement must respect the self-hosted trust boundary. Signals are computed from a local, in-instance event log that stays inside the deployment by default and is never phoned home. Any future export for product learning must be explicit opt-in and redacted (consistent with the privacy principle). V1 ships no external analytics.

### Guardrail Signals (must always hold — any violation is a release blocker)

These are invariants, not metrics to optimize:

- 0 instances of AI-executed SQL bypassing the Safety Gate.
- 0 database credentials, full secrets, or unauthorized fields sent to the AI provider.
- 100% of Key Findings reference at least one Evidence item.
- 100% of executed queries are read-only and recorded as Query Runs.

### Value Signals (what "working" looks like)

Directional signals, with first-pass targets to refine during implementation planning — not contractual numbers:

- **Time to first trusted answer (Querier):** a Querier reaches an `Answered`/`Partial` result with Evidence on a published Data Source within a few minutes of their first question.
- **Answerability rate:** share of questions that reach `Answered` or `Partial` versus those that stall in repeated `Needs Clarification` / `No Reliable Answer` without converting. A healthy product converts most non-answers via the Unblock Path.
- **Calibration cost (Admin):** an Admin can take a real database to a published, usable Data Source in roughly one focused session (target ~30 min, refine later). If this feels like data-governance work, the product fails its core promise.
- **Trust engagement:** share of Answers where the user expands Evidence/SQL at least once, and share of Answers handed off or reused. Evidence that is never opened may mean it is either perfectly trusted or ignored — read alongside reuse.
- **Unblock conversion:** share of non-answers where the user takes a forward action (picks a definition, sets a range, notifies an Admin) and reaches an answer.
- **Correction loop health:** number of Suggested corrections raised by Queriers and the share later Verified by Admins — evidence that questions are improving Data Source semantics over time.

### Anti-signals (indicate the product is not landing)

- Admins abandon calibration before publishing.
- Queriers stop returning after their first session.
- High non-answer rate that never converts even with the Unblock Path.
- Answers are produced but never handed off or reused (no downstream value).

### Decision Rule

After the first real-team usage period: **continue/scale** if the core loop produces trusted answers that get reused and Admin calibration cost is acceptable; **iterate** if value signals are mixed but guardrails hold; **pivot** if Queriers get answers but Admins won't sustain calibration (the calibration model is wrong); **stop** if even calibrated Data Sources cannot produce answers users trust. Guardrail violations always block release regardless of value signals.

## Language and Theme Requirements

- V1 UI supports English and Simplified Chinese.
- AI answers default to the language of the user’s question. If the language is unclear, fall back to the user’s assistant language preference, then UI language.
- V1 supports Light and Dark themes.
- The product must be checked in four combinations: English + Light, English + Dark, Chinese + Light, Chinese + Dark.
- Code, comments, tests, and commit messages are English.
- Product-facing orientation documents are maintained in both English and Chinese.
- **Accessibility baseline (V1):** the golden-path surfaces (Ask Data thread, composer, Answer, Data Source list/config) must be fully keyboard-operable, expose meaningful labels/roles for interactive elements, and meet WCAG AA contrast in all four language × theme combinations. Streamed-reasoning updates should be announced politely (not interrupt focus). Full WCAG conformance is roadmap; this baseline is V1.

## Roles and Capability Matrix

Roles are scoped to resources, not global. A user can hold different roles on different Connections and Data Sources. The first user to complete first-run bootstrap becomes the initial Owner of the default Team.

| Capability | Conn. Owner | Conn. Admin | DS Owner | DS Admin | DS Querier |
|---|---|---|---|---|---|
| Create a Connection | — (creator becomes Owner) | — | — | — | — |
| Edit / test / rotate / disable a Connection | ✓ | ✓ | — | — | — |
| Delete / transfer a Connection | ✓ | — | — | — | — |
| Attach a Connection to a Data Source | ✓ | ✓ | only if also Conn. Owner/Admin | only if also Conn. Owner/Admin | — |
| Create a Data Source | — | — | — (creator becomes Owner) | — | — |
| Run introspection / generate AI draft | — | — | ✓ | ✓ | — |
| Verify Business Glossary / Entity Mapping | — | — | ✓ | ✓ | — |
| Edit context / Policy / members | — | — | ✓ | ✓ | — |
| Publish / archive a Data Source | — | — | ✓ | ✓ | — |
| Invite members / assign DS roles | — | — | ✓ | ✓ (cannot grant Owner) | — |
| Delete / transfer ownership | — | — | ✓ | — | — |
| View a Draft Data Source | — | — | ✓ | ✓ | — |
| Ask questions on a Published Data Source | — | — | ✓ | ✓ | ✓ |
| View Answers / Evidence (within authorized scope) | — | — | ✓ | ✓ | ✓ |
| Raise a Suggested correction | — | — | ✓ | ✓ | ✓ |

Cross-cutting rules: being a Data Source Admin never implies Connection reuse rights — attaching a Connection requires Connection Owner/Admin on that Connection. Queriers never manage Connections and never see Draft sources. Credentials live only on the Connection and are never exposed through Data Source or Evidence surfaces (see also `Application States and Errors`).

## Application States and Errors

The Answer Contract defines the states of an *answer*; this section defines product behavior for the rest of the app's non-happy paths. Principle: every state is named in product terms with a next step (consistent with the `Unblock Path`); raw stack traces, SQL errors, provider errors, and secrets are never shown to Queriers.

### Connection states

`Untested → Testing → Healthy / Auth failed / Unreachable / TLS error / Disabled`. A Connection cannot be attached to a Data Source until it tests Healthy. Failure states show a product-level reason and a fix action (e.g. "credentials rejected — update and retest"); error text must never echo the secret. Disabling or editing a Connection must list the Data Sources it affects before confirming.

### Schema Snapshot states

`Running → Complete / Partial / Failed`. Partial (some tables unreadable due to grants) is a first-class outcome: the snapshot is marked Partial, calibration proceeds on available tables, and unreadable areas are flagged so Admins know coverage gaps. Failure offers retry and surfaces a product-level cause.

### Query execution states (inside an Investigation turn)

Each maps to an Answer status and an Evidence note: `Blocked by Safety Gate` → `Blocked by Policy`; `Timeout` / `Connection lost` → `Partial` or `No Reliable Answer` with the failure recorded; `Zero rows` → `Answered`/`No Reliable Answer` with explicit "no matching data"; `Truncated` → results capped per Policy with a Caveat. The Querier sees the product-level outcome and Unblock options, not the raw error.

### Per-screen UI states

Each primary surface defines empty, loading, error, and permission-denied states:

- **Empty:** no Data Sources (→ first-run/empty state), no Investigations yet (→ composer + samples), no history.
- **Loading:** skeletons for thread, lists, and Schema Snapshot; streamed reasoning covers the in-flight Investigation.
- **Permission-denied:** a Querier reaching a Draft or unauthorized Data Source sees a clear "not available to you", never a 404 that leaks existence beyond what Policy allows.
- **Error:** failed loads offer retry; never expose internal identifiers, provider names, or stack traces.

### Data Source publish-readiness

A Draft that does not meet the publish checklist (see `Sample Data Source` / Glossary publish requirements) shows exactly which prerequisites are missing and a path to each, rather than a disabled button with no explanation.

### Provider unavailable / misconfigured

If the AI provider is unreachable or misconfigured, Admins see a status on the provider page; Queriers see a graceful "investigation is temporarily unavailable, try again" — never raw provider/config detail. No question should fail silently.

## Product-level Architecture Boundaries

This section is not a detailed technical design. It defines the execution and trust boundaries the product must preserve. Future architecture documents and implementation plans must follow these boundaries.

### AI Execution Boundary

AI does not directly access databases, hold database credentials, or execute SQL. AI can only propose plans, SQL drafts, or tool call requests.

The application backend is responsible for:

- Loading Data Source Context, Verified Business Glossary, Verified Entity Mapping, and Policy.
- Providing only necessary and bounded context to AI.
- Validating AI-generated SQL or tool calls.
- Authorizing, executing, redacting, truncating, and recording query results.
- Sending only bounded result summaries or necessary samples back to AI for interpretation.

### V1 Execution Runtime

V1 uses **Backend Direct Connection**:

- The self-hosted Web App backend connects to databases using credentials stored on Connections.
- Query execution happens inside the team’s own deployment environment.
- SQL execution must pass through the Safety Gate.
- V1 executes only controlled read-only queries.

Future versions may introduce a Worker / Agent Runtime, but this is not part of the V1 main path. Worker Runtime may support network isolation, long-running tasks, queues, audit boundaries, or a future hybrid control plane.

### SQL Safety Gate

All SQL must pass deterministic safety checks before execution. The Safety Gate must at least decide:

- Whether the SQL is read-only.
- Whether it targets an allowed Connection.
- Whether it accesses allowed tables and fields.
- Whether it touches sensitive fields or redaction rules.
- Whether it needs row limits, time windows, or query timeouts.
- Whether it requires user confirmation.
- Whether it contains mutation, DDL, permission, maintenance, or administrative commands.

Queries rejected by the Safety Gate cannot execute. AI cannot override Safety Gate decisions.

### Result Redaction and Bounded Context

Query results must be bounded before being sent back to AI for interpretation:

- Redact sensitive fields according to Policy.
- Truncate large result sets.
- Prefer aggregates, summaries, samples, and schema-aware result summaries.
- Do not send database credentials, full secrets, unauthorized fields, or unnecessary raw data to the AI provider.

The product should assume by default that the AI provider is an external service, so data sent to the model must be minimized.

### Schema Snapshot Boundary

Schema introspection is performed by the application backend. AI uses Schema Snapshots, not direct database access.

A Schema Snapshot may include tables, columns, types, foreign keys, indexes, comments, and statistical summaries. It is context for structural understanding, not business fact. Business facts must be supported by Verified Business Glossary, Verified Entity Mapping, and actual Query Runs.

### Evidence Recorder

Every Query Run must record enough evidence metadata, including:

- Data Source
- Connection
- SQL
- parameters or parameter summary
- execution status
- execution time
- row count
- result summary
- safety classification
- redaction/truncation notes
- related Answer version

This ensures Answers can be reviewed, handed off, and used as future Playbook material.

### Provider Boundary

AI provider is a replaceable dependency and should not become a primary UI concept. V1 may include provider configuration, but Queriers must not see provider, model, raw prompt, raw tool payload, or debug trace in the main flow.

Provider changes should not alter core product semantics. Data Source, Policy, Evidence, and Answer Contract must remain stable.

## Cross-Connection Comparison Scope (D1)

Decision: V1 supports cross-Connection *comparison*, never cross-Connection *SQL*.

The agent may run separate read-only queries against each Connection and then compare or reconcile the bounded results at the reasoning layer (e.g. "usage in DB A vs invoices in DB B"). Each SQL statement still executes inside exactly one Connection — there is no cross-Connection JOIN, no virtual table, and no strongly-consistent cross-database transaction (these remain Non-goals).

Conditions and guardrails:

- A cross-Connection comparison requires a Verified Entity Mapping for the relating key. Without it the agent does not guess — it returns the Unblock Path ("notify Admin to verify mapping").
- Cross-Connection conclusions must carry a Caveat about timing/consistency (sources may lag one another) and may not be rated `High` Confidence.
- Comparison runs only over bounded, redacted result summaries already returned through the Safety Gate — never by sending raw cross-source rows to the model beyond Policy limits.

Options considered: **(A, chosen)** bounded per-Connection queries + reasoning-layer comparison, gated by a Verified mapping; (B) defer all cross-Connection work to roadmap — rejected, it makes the common reconciliation question class unanswerable in V1; (C) federated / virtual joins — rejected, violates Non-goals. The prototype's cross-Connection example demonstrates option A, including the Unblock Path when the mapping is unverified.

Tech-spec inputs: how per-Connection partial results are correlated, the bounded-context size for comparison, and the exact Confidence cap.

## Evidence Redaction and Visibility (D4)

Decision: redaction applies at the Evidence display layer using the same Policy that governs execution — there is no separate, weaker display rule.

What a Querier sees in Evidence is the Policy-bounded form: sensitive field values are redacted, identifiers and schema references outside the Data Source's authorized scope are masked or omitted, and the SQL shown is the as-executed, Policy-bounded statement (not arbitrary internal SQL). Credentials and secrets never appear in Evidence for any role.

Visibility is role-aware:

- **Querier:** Policy-redacted Evidence within authorized scope — SQL inspectable but bounded, sensitive values masked.
- **Data Source Admin / Owner:** fuller Evidence detail for calibration and review, still never raw credentials.

When redaction or truncation affects what is shown, the Answer notes it as a Caveat (consistent with the Answer Contract and Evidence Rules).

Options considered: **(A, chosen)** Evidence redaction = execution Policy, role-aware; (B) full SQL/Evidence to anyone authorized to the Data Source — rejected, it leaks sensitive field names/values and out-of-scope schema to Queriers; (C) hide SQL from Queriers entirely — rejected, it violates "every answer needs evidence / SQL inspectable."

Tech-spec inputs: the masking representation (e.g. `‹redacted›` vs omitted), whether sensitive *column names* (not only values) are masked in displayed SQL, and the precise Admin-vs-Querier detail boundary.

## V1 Product Scope

The V1 goal is to complete an end-to-end, verifiable product loop: an Admin creates and publishes a controlled Data Source; a Querier asks a question against that Data Source; the system runs a controlled read-only Investigation; and the user receives an Answer with Evidence.

### In Scope for V1

1. **Self-hosted Web App**  
   One deployment has one Team by default. Team is an internal container, not a primary UI concept.

2. **User and membership basics**  
   Support User, Data Source Membership, and Connection Membership. Data Source roles are Owner / Admin / Querier. Connection roles are Owner / Admin.

3. **Connection management**  
   Support creating, testing, disabling, and reusing Connections. Connection is a Team-level technical resource. Only users with Connection permission can attach it to a Data Source.

4. **Data Source lifecycle**  
   Support Draft -> Published -> Archived. Draft is visible only to Owner/Admin, Published is visible to authorized members, and Archived preserves history but cannot be queried.

5. **Data Source calibration**  
   Support schema introspection, Schema Snapshot, AI-generated context draft, Business Glossary, Entity Mapping, and Suggested -> Verified.

6. **Policy basics**  
   Support read-only restrictions, table/field scope, row limits, query timeout, sensitive-field redaction, auto-execution conditions, and confirmation conditions.

7. **Ask Data flow (conversation-first)**  
   A Querier can select an authorized Data Source and ask a natural-language question inside a resumable Investigation Thread, receiving streamed reasoning, clarifications, a durable Answer with Evidence, and the ability to follow up (appending new turns / Answer versions). A history rail lists recent Investigations. See `Interaction Model`.

8. **Controlled read-only execution**  
   AI only proposes plans and SQL. The application backend executes read-only queries after Safety Gate validation.

9. **Answer Contract**  
   Answer must include Status, Direct Answer, Confidence, What I Did, Key Findings, Evidence, Assumptions, Caveats, Recommended Follow-ups, and Version Metadata.

10. **Evidence and Query Runs**  
    Every Query Run records SQL, source, status, result summary, safety classification, redaction/truncation notes, and related Answer version.

11. **Sample Data Source**  
    Provide an executable Sample Data Source that does not require an extra database, for onboarding, demo, QA, and smoke testing.

12. **Bilingual UI and themes**  
    Support English / Simplified Chinese and Light / Dark. Code, comments, tests, and commit messages remain English.

13. **Basic AI provider configuration**  
    V1 needs enough provider configuration for a self-hosted instance to run, but provider/model/debug must not become Querier-facing main-flow concepts.

### Roadmap-only for V1

The following capabilities may keep interfaces or documented boundaries, but do not enter the V1 main path:

- Playbook editor
- AI-suggested Playbook activation
- Report / Monitor / Alert
- Dashboard builder
- Complex IAM
- Multi-step organizational approval workflow
- Native desktop app
- Plugin marketplace
- Worker / Agent Runtime
- Federated query engine or cross-Connection SQL join
- Public SaaS multi-tenant platform

## Implementation Milestones

V1 scope is large; it is delivered as three independently demoable milestones that order work from highest product risk to lowest. This slices Phase 1 of the roadmap; it does not change scope.

### M0 — Trusted loop on the Sample Data Source (no real database)

Goal: validate the single biggest unknown — does a trusted Answer actually feel trustworthy? Build the conversation-first Ask Data thread, streamed reasoning, the full Answer Contract (Status, Direct Answer, Confidence, Key Findings, Evidence with collapsed SQL, Assumptions, Caveats, Follow-ups, versioning), follow-ups that append turns, the Unblock Path, and bilingual + light/dark — all against the executable Sample Data Source. No real Connections, no calibration authoring. This is the smoke-test backbone and de-risks the Answer Contract cheaply.

### M1 — Real PostgreSQL and controlled execution

Goal: validate the safety/execution machinery on a real database. Adds first-run bootstrap + local accounts, Connection management, schema introspection / Schema Snapshot, Backend Direct Connection, the SQL Safety Gate, read-only execution, result redaction and bounded context, the Evidence Recorder, the separate metadata store, and credential encryption. After M1, the loop runs against a real PostgreSQL Connection.

### M2 — Calibration, publishing, and team roles

Goal: make a real Data Source usable by a team. Adds AI-drafted Data Source Context, Business Glossary and Entity Mapping with `Suggested → Verified`, Policy configuration, the Draft → Published → Archived lifecycle, Data Source and Connection memberships with the capability matrix, the Correction & Feedback loop, and the minimal provider status/config page.

Each milestone maps to a subset of the Success Criteria and ships with its own acceptance check. Roadmap Phases 2+ remain post-V1.

## Sample Data Source

The Sample Data Source is an executable demo source, not a static UI mock. It uses lightweight demo data and must not require users to provision an extra sample database. It must:

- Be clearly labeled as Sample.
- Support the full Ask Data -> Investigation -> SQL/evidence -> Answer loop.
- Be hideable or removable.
- Support onboarding, demo, QA, and smoke testing.

If a future need exists to validate a real PostgreSQL adapter path, the project may provide an optional full sample stack such as a Docker Compose profile. It must not be required for normal deployment.

## V1 Product Decisions

These decisions are the first-version assumptions for PRD v0.1. Implementation planning may refine the technical approach, but should not change these product boundaries without updating the PRD first.

1. **First real database type: PostgreSQL first**  
   V1’s first real business database adapter is PostgreSQL. Product terminology keeps the broader Connection abstraction, but implementation planning targets the PostgreSQL read-only path first. The Sample Data Source may use a lightweight demo adapter; an optional full sample stack may validate the PostgreSQL path.

2. **User authentication and first admin: local accounts + first-run bootstrap**  
   V1 uses local accounts inside the self-hosted instance. When the instance starts with no users, the first user who completes setup becomes the initial Owner for the default Team. Later users join through invitations. SSO, OIDC, SCIM, and enterprise identity integrations belong in the roadmap.

3. **AI provider configuration: deployment config first, settings only for status and minimal management**  
   V1 connects to the AI provider through environment variables or deployment configuration. The product may include an Admin-only provider status page or minimal configuration page, but provider/model/debug never enter the Querier main flow. Local model support is not required in V1.

4. **Connection credential storage: application-level encryption, secret manager as extension**  
   V1 must encrypt Connection credentials and require the deployer to provide an encryption secret. Future versions may integrate external secret managers. Credentials are stored only on the Connection, never copied to Data Sources, and never sent to the AI provider.

5. **Metadata storage: separate product metadata store**  
   Team, User, Connection, Data Source, Policy, Investigation, Answer, and Evidence metadata must live in the product’s own metadata store, not in user business databases. User business databases are queried data sources only.

6. **Default Policy: strict, safe, low-surprise**  
   V1 defaults to read-only access, row limits, query timeouts, collapsed SQL, and recorded Query Runs. Missing time ranges, likely broad scans, sensitive fields, cross-Connection summaries, or unverified mappings require confirmation or clarification by default. Exact thresholds are determined in implementation planning.

7. **Answer version UI: latest first, lightweight history**  
   The underlying model supports multiple Answer versions. V1 UI defaults to the latest Answer and provides a lightweight entry to previous answers. It does not include complex diff, branching, or version-management UI.

8. **V1 chart scope: table and simple comparison first**  
   V1 Answers may include table and simple comparison. Bar and line charts belong in the near-term roadmap unless they are cheap to implement and do not distract from the main flow. V1 does not include a chart editor.

9. **Result retention: keep summaries and Evidence, limit raw large results**  
   V1 keeps Answers, Evidence, Query Run metadata, and result summaries by default. Raw large result sets are not retained long-term by default, or are retained only under strict limits. Admin-configurable retention is a roadmap capability; V1 may start with safe defaults.

10. **Business-user onboarding: supported but not primary**  
    V1 supports business/ops/product teammates as Queriers for published Data Sources, but onboarding and the main experience prioritize technical data request handlers. Dedicated non-technical onboarding, access requests, and stronger explanation layers belong in the roadmap.

## PRD Self-review

### Consistency Check

- Product positioning remains a small-team self-hosted AI Data Portal, not a SQL IDE or BI dashboard builder.
- Data Source is the primary product object, while Connection is the underlying technical resource.
- AI does not directly execute SQL, hold credentials, or bypass Policy.
- Answer Contract matches Success Criteria: trusted answers require Evidence, Assumptions, Caveats, and Confidence.
- Roadmap capabilities do not enter primary navigation or the V1 golden path.

### Known Tensions

- V1 introduces both Data Source Membership and Connection Membership. This adds model complexity, but prevents “reusing a Connection equals indirectly gaining a database entry point.”
- Data Source calibration is required, but must stay lightweight or Admins will feel they are doing full data governance.
- Provider configuration is necessary for self-hosted operation, but must not become a Querier main-flow concept.
- The underlying model should support Answer versioning, but the UI must stay light and avoid becoming a complex version-management tool.
- The Sample Data Source must be executable, but must not add a database dependency to normal deployment.
- PostgreSQL first is an implementation narrowing, not a permanent product boundary. Product terminology should keep room for future database adapters.
- The conversation-first model must stay bounded. A resumable thread with streamed reasoning and quick actions makes the product feel like a modern AI tool, but every addition is one step closer to a noisy general chatbot. The Interaction Non-goals and UI Failure Criteria are the guardrails: conversation enriches the path to a trusted Answer, it does not replace the Answer.
- The correction feedback loop adds value (Querier questions improve Data Source semantics) but must not let Queriers mutate Verified context. Corrections are always Suggested edits for Admin review.

### Over-promise Check

The PRD explicitly does not promise:

- arbitrary natural-language access to all data
- cross-Connection SQL joins
- replacement for BI, warehouse, ETL, DBA tools, or SQL IDEs
- AI automatically understanding or changing business definitions
- executing mutations or database administration operations
- uploading real schema, SQL, results, or Playbooks from self-hosted deployments

### UI Noise Check

The following concepts must not become Querier main-screen elements:

- provider
- model
- adapter
- fixture
- session
- artifact
- raw tool payload
- debug trace
- review decision
- complex policy matrix

## Next Discussion Reminder

As of v0.3 the PRD is considered development-ready: it can serve as the baseline for the tech-spec phase. Remaining work moves into implementation planning rather than further product definition.

When the tech-spec phase begins, prioritize:

1. Stand up the standalone `product-next` repository and port this PRD set as the authoritative product reference.
2. Start the tech spec from **M0** (the Sample-Data-Source trusted loop) — it de-risks the Answer Contract with no real-database dependency.
3. Turn the Answer Contract (including the Status × Confidence matrix and Unblock Path) into a concrete schema plus M0 smoke-test assertions.
4. Pin the still-open implementation inputs: PostgreSQL-first adapter, first-run bootstrap, metadata store, credential encryption, provider config, and default Policy thresholds. D1 (cross-Connection comparison) and D4 (Evidence redaction) now have product decisions recorded above — only their mechanics remain for the tech spec.
