# evidata Constitution

## Core Principles

### I. Trust Boundary First

AI proposes; application code validates, executes, redacts, records, and
persists. Specs and implementations must not let the model execute SQL, hold
credentials, bypass Policy, persist unvalidated Answers, or make unsupported
data claims.

### II. Evidence Before Claims

Every persisted data claim belongs to the Answer Contract and must be backed by
Evidence and QueryRun records. Message paths, UI summaries, retries, and
follow-ups must not smuggle claims around validation, versioning, redaction, or
persistence.

### III. Metadata and Secrets Stay Isolated

Product metadata lives in evidata metadata storage, not user business
databases. Connection credentials, raw secrets, provider payloads, PII, and
unredacted result rows must not reach the model, client logs, or durable
evidence.

### IV. Minimal Changes Win

Use Ponytail mode: reuse existing repo patterns, native platform features, and
already-installed dependencies before adding code. Do not add speculative
abstractions, new dependencies, or generated artifacts unless the current
feature needs them.

### V. Verification Matches Risk

Small changes get the smallest runnable check that proves them. Shared
contracts, data-model changes, authz, SQL execution, persistence, and
user-facing workflows need focused regression coverage; UI changes need real
browser verification.

## Spec Kit Scope

Use `docs/spec-kit-harness.md` to decide whether work is Small, Medium, or
Large. Full Spec Kit is for Large work only. Medium work records lightweight
`Spec / Plan / Verify` in the GitHub issue. Small fixes use normal issue + PR
flow and do not create spec artifacts.

Large feature specs add feature-level user stories and data-model deltas. They
must reference the existing baselines instead of recreating project-level
documents:

- `docs/prd.en.md`
- `docs/roadmap.en.md`
- `docs/glossary.en.md`
- `docs/tech-spec/`

## Development Workflow

Work is issue-driven. Branch from `main`, open a PR, keep required checks green,
and land by rebase merge. PR descriptions must state intent, changed behavior,
verification, and issue references. Large frontend work needs maintainer review
of the plan and prototype before implementation.

## Governance

This constitution governs Spec Kit artifacts for evidata. Changes to trust
boundaries, public product scope, durable data models, or this constitution
require maintainer approval and matching updates to the owning PRD, roadmap,
tech-spec, or harness document.

**Version**: 1.0.0 | **Ratified**: 2026-07-04 | **Last Amended**: 2026-07-04
