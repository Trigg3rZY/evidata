# Repository Instructions

This repository builds evidata, an evidence-backed AI data portal. Treat product
trust boundaries as first-class requirements.

## Development

- Prefer small, reviewable changes with focused tests.
- Keep implementation aligned with `docs/tech-spec/` and the PRD in `docs/prd.en.md`.
- Use the repo's existing TypeScript, package, and test patterns before adding new abstractions.
- Do not weaken the core boundary: AI proposes; application code validates, executes, redacts, records, and persists.
- For behavior changes, run the narrowest relevant tests first, then broader verification when the change touches shared contracts or user-facing flows.

## Collaboration & workflow

How work is run in this repo — project conventions that apply to any agent or
contributor, not one session's memory:

- **Backlog is issue-driven.** Capture every actionable request as a GitHub issue with a priority label (`priority:high` / `priority:medium` / `priority:low`; `epic` for umbrellas); pull work from the board rather than working ad hoc.
- **Branch + PR cadence.** Never commit to `main` (protected by the `protect-main` ruleset). Branch off `main`, open a PR, land via **rebase merge**, and keep the branch rebased on `main` so required checks run on the merged state.
- **Required checks must pass before merge.** CI gates: `typecheck-and-test` and `smoke (M0 acceptance gate)`. Don't merge red. Postgres-integration tests are gated on `TEST_DATABASE_URL` (hermetic otherwise).
- **PR review = Codex.** Codex auto-reviews PRs and leaves inline comments graded P0/P1/P2. Read them; fix P1/P2 (P0 always); acknowledge with a 👍 reaction; re-push. Codex does not auto re-review on push, so merge once checks are green and comments are addressed rather than waiting for a second pass.
- **Decision gating.** Proceed autonomously on small, well-scoped tasks; stop and ask the maintainer (with explicit options) on milestone, product, or architecture decisions — anything that changes scope, public surface, or a hard-to-reverse choice.
- **Spec-first + lockstep.** Weigh `docs/tech-spec/` before building; apply industry best practices; update spec and code together so they never drift.
- **Verification discipline.** Don't claim done without verification; verify UI changes in a real browser (not just a successful build); diagnose before fixing (observe → hypothesize → verify); state any verification you could not run.
- **Attribution.** End AI-assisted commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`; end PR descriptions with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Local dev for DB-backed work.** The gated Postgres integration tests need a local Postgres (e.g. colima + a `postgres:16` container) and `TEST_DATABASE_URL`; without it those tests skip.

## Codex Review Guidance

When reviewing pull requests, prioritize high-signal findings. Flag issues as P0/P1 when they can break trust, safety, data integrity, or core workflows.

Focus especially on:

- Answer Contract regressions: every data claim in an `Answer` must be evidence-backed, validated, versioned, and persisted correctly.
- Message vs Answer boundaries: lightweight `Message` paths must not smuggle data claims or bypass evidence guarantees.
- SQL execution safety: only read-only queries may execute; `SafetyGate`, executor bounds, redaction, and QueryRun/Evidence recording must remain mandatory.
- Data leakage risks: credentials, raw rows, secrets, PII, provider payloads, stack traces, and unredacted internals must not reach the model, client, logs, or persisted evidence.
- Harness control flow: intent routing, force-finalize, cancellation, retries, usage telemetry, IME input handling, and SSE events should preserve documented behavior.
- Persistence consistency: aborted or failed turns must not leave orphaned or contradictory Investigation, Answer, Message, Evidence, or QueryRun records.
- Tests: meaningful behavior, contract, safety, stream, and UI changes should include focused regression coverage.

For docs-only PRs, review the design for implementability, contract consistency, phase boundaries, and whether tests are specific enough to catch the stated regressions.

## Verification Hints

- `pnpm test`
- `pnpm test:smoke`
- `pnpm lint`

Use the smallest command that proves the change, and mention any verification you could not run.
