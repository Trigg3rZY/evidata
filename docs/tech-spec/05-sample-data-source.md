# 05 — Sample Data Source (M0)

The Sample Data Source is the executable backbone of M0: a real, queryable dataset that exercises the full Ask Data → Investigation → SQL/Evidence → Answer loop with **no external database**. It runs in `pglite` (embedded Postgres) seeded at startup, behind the `Connector`/`QueryExecutor` interface (spec 01) so M1's `PostgresConnector` is a drop-in.

PRD references: `Sample Data Source`, `Sample Data Source` decisions, `Success Criteria #10`.

## 1. Properties (from PRD)

- Clearly labeled as **Sample**.
- Supports the full loop (real SQL, real Evidence) — not a static mock.
- Requires no extra database provisioning (pglite is in-process).
- Hideable / removable.
- Used for onboarding, demo, QA, and the M0 smoke gate.

## 2. Domain: an "Advertising Platform" (matches the prototype)

A small ads/billing business system, enough to demonstrate trusted answers and the Unblock Path. Two logical areas (`usage`-like spend and `billing`-like invoices) so the cross-area reconciliation scenario is meaningful even within one Sample source.

### 2.1 Schema (seeded into pglite)

```sql
-- accounts (customers)
CREATE TABLE accounts (
  id            integer PRIMARY KEY,
  name          text NOT NULL,
  status        text NOT NULL,              -- 'active' | 'churned'
  created_at    date NOT NULL
);

-- campaigns
CREATE TABLE campaigns (
  id            integer PRIMARY KEY,
  account_id    integer NOT NULL REFERENCES accounts(id),
  name          text NOT NULL,
  budget        numeric(12,2) NOT NULL
);

-- daily spend per campaign
CREATE TABLE campaign_spend (
  id            bigint PRIMARY KEY,
  account_id    integer NOT NULL REFERENCES accounts(id),
  campaign_id   integer NOT NULL REFERENCES campaigns(id),
  day           date NOT NULL,
  amount        numeric(12,2) NOT NULL,
  status        text NOT NULL              -- 'posted' | 'void'
);

-- invoices (billing area)
CREATE TABLE invoices (
  id            integer PRIMARY KEY,
  account_id    integer NOT NULL REFERENCES accounts(id),
  period_month  date NOT NULL,             -- first day of month
  amount        numeric(12,2) NOT NULL,
  settled_at    date,                      -- may lag usage; nullable
  customer_ref  text                       -- intentionally NOT a clean FK to accounts
);

-- a column to exercise sensitive-field redaction
ALTER TABLE accounts ADD COLUMN contact_email text;  -- marked sensitive in Policy
```

`invoices.customer_ref` is intentionally a loose reference (not a clean FK) so the cross-area question requires a **mapping** that is only `Suggested` — driving the Unblock Path scenario (§4.3).

### 2.2 Seed dataset (shape)

- ~6 accounts (incl. `ACME`), 1 churned, the rest active; `contact_email` populated (sensitive).
- ~12 campaigns; `ACME` has a `Summer Sale` campaign plus a couple of always-on ones.
- `campaign_spend`: daily rows for May–June 2026; `ACME` shows a June surge concentrated in `Summer Sale` (Jun 1–9), a few `void` rows to exercise the "exclude void" definition.
- `invoices`: monthly invoices; some `settled_at` after the period (lag), some unsettled — enough to make reconciliation approximate.

Concrete numbers are fixtures so smoke assertions are stable (e.g. ACME May spend `34900`, June `48200`, +38.1%).

### 2.3 Data Source Context (pre-Verified for M0)

Since M0 has no calibration UI, the Sample ships with pre-`Verified` context so answers are trustworthy:

- Overview, "good for / not for" (matches the prototype overview).
- Business Glossary (Verified): `spend = campaign_spend.amount excluding status='void'`; `active account`; `settlement date = invoices.settled_at`.
- Entity Mapping (Verified): `Customer → accounts.id`, `Campaign → campaigns.id`.
- Entity Mapping (**Suggested**, intentionally NOT verified): `Invoice.customer_ref → accounts.id` — the gap that triggers the Unblock Path.
- Policy: read-only, rowLimit 1000, timeout 5s, `accounts.contact_email` sensitive, auto-execute low-risk.

## 3. Lifecycle & isolation

- On server start, a pglite instance is created and seeded (idempotent). Sample data lives in its own schema/database, separate from the product MetadataStore (PRD: product metadata never written into the business DB).
- The Sample can be hidden/removed via config (`SAMPLE_DATA_SOURCE=off`); the rest of the app still runs.
- Reseed is deterministic — tests get identical data every run.

## 4. Canned scenarios (drive FixtureProvider + demo)

Each scenario is keyed by id; the `FixtureProvider` replays its `AgentStep`s, and the real provider should reach equivalent outcomes. These are the demo script and the smoke fixtures.

### 4.1 `acme-bill-up` — happy path, multi-query, Answered/Medium

Question: "Why is ACME's ad bill higher this month than last month?" → resolves ACME → compares May/June spend (E1) → per-campaign breakdown (E2) → reconciles against invoices (E3) → `Answered`, `Medium` (cross-area timing caveat), Key Findings cite E1/E2/E3, follow-ups offered. (This is the prototype's main answer.)

### 4.2 `top-customers` — single-query, Answered/High

Question: "Top 5 customers by spend last quarter?" → one aggregate query (E1) → `Answered`, `High` (single source of truth, no material assumptions).

### 4.3 `cross-area-reconcile` — Unblock Path, NoReliableAnswer

Question: "Why don't usage and billing reconcile for ACME?" → confirms each area's totals separately → needs `Invoice.customer_ref → accounts.id` which is only `Suggested` → `NoReliableAnswer` + `UnblockPath` (`unverified_mapping` → `notify_admin_verify` (createsSuggestion) + `pick_definition` usage-date/invoice-date + `narrow_question`). Picking a definition or the narrow question yields a follow-up Answer; `notify_admin_verify` records a Suggested item. (This is the prototype's blocked example.)

### 4.4 `needs-timerange` — NeedsClarification

Question: "How is spend trending?" (no time window) → `NeedsClarification` + `UnblockPath` (`time_range` → `set_time_range` with suggested defaults). Answering appends a version.

### 4.5 `mutation-attempt` — BlockedByPolicy (guardrail)

Provider (in a deliberately adversarial fixture) proposes an `UPDATE`; the Safety Gate rejects (`not_read_only`) → `BlockedByPolicy` + `view_mutation_draft`. Proves the gate blocks writes and the boundary holds.

### 4.6 `sensitive-field` — redaction

Question references customer contact info → query touches `accounts.contact_email` → Redactor masks values; Evidence shows `contact_email` in `redactedColumns`; a Caveat notes redaction.

## 5. Why this shape

The Sample is designed so a single in-process dataset exercises: a clean Answered/High, a nuanced Answered/Medium with multi-Evidence, all three non-answer statuses with distinct Unblock kinds, the read-only guardrail, and field redaction — i.e. the entire Answer Contract surface and the entire `03` state machine, before any real database exists.
