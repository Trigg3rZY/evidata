# Repository Instructions

This repository builds evidata, an evidence-backed AI data portal. Treat product
trust boundaries as first-class requirements.

## Development

- Prefer small, reviewable changes with focused tests.
- Keep implementation aligned with `docs/tech-spec/` and the PRD in `docs/prd.en.md`.
- Use the repo's existing TypeScript, package, and test patterns before adding new abstractions.
- Do not weaken the core boundary: AI proposes; application code validates, executes, redacts, records, and persists.
- For behavior changes, run the narrowest relevant tests first, then broader verification when the change touches shared contracts or user-facing flows.

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
