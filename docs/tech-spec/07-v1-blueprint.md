# 07 — Full V1 Blueprint (M0 → M1 → M2)

This is the umbrella view of the whole V1: how the system grows from the M0 trusted-answer loop into a self-hosted, multi-user, calibrated product, with every milestone adding capability behind interfaces that already exist in M0. M1 and M2 are specified at architecture-skeleton depth (08, 09); M0 (01–06) is the only milestone specified to implementation depth.

PRD references: `V1 Product Scope`, `Implementation Milestones`, `Roles and Capability Matrix`, `Product-level Architecture Boundaries`.

## 1. System at the end of V1

```
┌──────────────────────────────────────────────────────────────────────────┐
│ apps/web (Next.js)  — Ask Data (thread) · Data Sources · Admin calibration │
│   auth session (M1) · capability-gated UI (M2)                             │
└───────────────┬────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ packages/core                                                              │
│   InvestigationService · AgentRunner · SafetyGate · Redactor · Evidence    │  ← built in M0
│   AuthService · ConnectionService · IntrospectionService (M1)              │
│   CalibrationService · PolicyService · PublishingService ·                 │
│   MembershipService · SuggestionService · ProviderConfig (M2)             │
└───────────────┬───────────────────────────┬────────────────────────────────┘
                ▼                           ▼
        ports (Connector, QueryExecutor,    MetadataStore (Postgres, M1)
        AgentProvider, Redactor, ...)
                │
     ┌──────────┴───────────┐
     ▼                      ▼
  SampleConnector       PostgresConnector (M1)   ← same interface
  (pglite, M0)          (real DB, encrypted creds)
```

The M0 controller (AgentRunner + SafetyGate + Redactor + EvidenceRecorder) is unchanged by M1/M2 — they add data sources, identity, and authoring around it. That is the payoff of the ports-and-adapters design in `01`.

## 2. Milestone → capability map

| Capability area | M0 | M1 | M2 |
|---|---|---|---|
| Conversation loop, Answer Contract, Unblock Path | ✅ | (unchanged) | (unchanged) |
| Streamed reasoning, versioning, history | ✅ | | |
| Safety Gate, Redactor, Evidence Recorder | ✅ (on Sample) | operates on real data | |
| Sample Data Source (pglite) | ✅ | stays for demo/QA | |
| Real Connections + credential encryption | | ✅ | |
| Schema introspection / Schema Snapshot | | ✅ | |
| Backend Direct Connection, read-only execution on real DB | | ✅ | |
| First-run bootstrap + local accounts/auth | | ✅ | |
| Metadata store on real Postgres | | ✅ | |
| Data Source Context + AI draft | | | ✅ |
| Business Glossary / Entity Mapping (Suggested→Verified) | seeded Verified | | authoring ✅ |
| Policy configuration | seeded default | | editor ✅ |
| Data Source lifecycle (Draft→Published→Archived) | | | ✅ |
| Memberships + capability matrix enforcement | single dev identity | auth identities | full matrix ✅ |
| Correction & Feedback loop (review side) | records Suggested | | review/verify ✅ |
| Provider status/config page | env only | | minimal page ✅ |

## 3. Data model evolution

M0 entities (in pglite metadata schema): `Investigation`, `Turn`, `Answer` (+ versions), `Evidence`, `QueryRun`, `Suggestion` (recorded only). The Sample's business tables live in a separate schema.

M1 adds (metadata store, now real Postgres): `User`, `Session`, `Connection` (encrypted credential blob), `ConnectionMembership`, `SchemaSnapshot`. `Investigation` gains a real `dataSourceId` FK once Data Sources exist (M2) — in M1 it still points at the Sample or a minimal implicit source.

M2 adds: `DataSource`, `DataSourceConnection`, `DataSourceContext`, `BusinessGlossaryTerm` (+ status), `EntityMapping` (+ status), `Policy`, `DataSourceMembership`. `Suggestion` gains a review lifecycle (`open → accepted/rejected`).

```
User ─< DataSourceMembership >─ DataSource ─< DataSourceConnection >─ Connection
                                   │                                    │
                                   ├─ DataSourceContext                 └─ SchemaSnapshot
                                   ├─ BusinessGlossaryTerm (status)     ConnectionMembership
                                   ├─ EntityMapping (status)
                                   ├─ Policy
                                   └─< Investigation >─ Turn / Answer(version) ─ Evidence ─ QueryRun
                                                          └─ Suggestion (review)
```

A full Drizzle schema is produced incrementally: M0 ships the investigation/answer/evidence/suggestion tables (specified to implementation depth in `10-m0-data-model-and-persistence.md`); M1 and M2 add migrations. Migrations are forward-only and versioned.

## 4. Trust boundary across V1

- The boundary defined in M0 (`01 §4`) is the permanent one: AI proposes; the app validates/executes/redacts/records. M1 makes it real (real credentials, real rows) without changing where the boundary sits.
- M1 adds credential encryption: credentials live only on `Connection`, encrypted with a deployer-provided secret, never copied to Data Sources, never sent to the provider (PRD decision 4). The Redactor guarantee from M0 already prevents secret/PII leakage to the model.
- M2 adds authorization: every service call is capability-checked against the `Roles and Capability Matrix`; Queriers never reach Connections or Draft sources.

## 5. What stays out of V1 (roadmap)

Per PRD `Roadmap-only for V1` and the roadmap doc: Playbook editor/auto-suggestion, Reports, Monitors/Alerts, dashboard builder, complex IAM, multi-step approvals, native desktop app, plugin marketplace, Worker/Agent runtime, federated query / cross-Connection SQL join, public multi-tenant SaaS. The ports (Connector, QueryExecutor, AgentProvider, Policy, Playbook spec) are the designed extension seams for these.

## 6. Detailed chapters

- `08-m1-real-postgres-and-execution.md`
- `09-m2-calibration-publishing-and-roles.md`
