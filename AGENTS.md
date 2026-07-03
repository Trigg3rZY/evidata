# Repository Instructions

This repository builds evidata, an evidence-backed AI data portal. Treat product
trust boundaries as first-class requirements.

## Development

- Prefer small, reviewable changes with focused tests.
- Keep implementation aligned with `docs/tech-spec/` and the PRD in `docs/prd.en.md`.
- Use the repo's existing TypeScript, package, and test patterns before adding new abstractions.
- Do not weaken the core boundary: AI proposes; application code validates, executes, redacts, records, and persists.
- For behavior changes, run the narrowest relevant tests first, then broader verification when the change touches shared contracts or user-facing flows.

## Ponytail mode

Use Ponytail mode for coding work in this repo: the laziest solution that is
correct, tested, and compatible with evidata's trust boundaries.

Before writing code, stop at the first rung that holds:

1. Does this need to exist at all?
2. Does this already exist in the codebase? Reuse the helper, type, or pattern.
3. Does the standard library or native platform cover it?
4. Does an already-installed dependency cover it?
5. Can it be one line?
6. Only then, write the minimum code that works.

- No speculative abstractions, boilerplate, config, or dependencies.
- Deletion over addition; boring over clever; fewest files possible.
- Bug fixes go at the root cause: read callers and fix the shared path once.
- Non-trivial logic leaves one focused runnable check. Trivial one-liners need no test.
- Mark intentional shortcuts with a `ponytail:` comment that names the ceiling and upgrade path.
- Never simplify away trust-boundary validation, security, redaction, persistence,
  data-loss-preventing error handling, accessibility, or explicit product requirements.

## Collaboration & workflow

How work is run in this repo — project conventions that apply to any agent or
contributor, not one session's memory:

- **Backlog is issue-driven.** Capture every actionable request as a GitHub issue with a priority label (`priority:high` / `priority:medium` / `priority:low`; `epic` for umbrellas); pull work from the board rather than working ad hoc.
- **Umbrellas, sub-issues & closing keywords.** Track multi-PR work under an `epic` (or a plain umbrella issue) and split the pieces into sub-issues or a checklist. Only a PR that *fully* resolves an issue uses a closing keyword (`Closes #N`) — merging it auto-closes that issue on `main`; partial PRs reference without closing (`Part of #N` / `Refs #N`) so an umbrella isn't closed before its last piece lands.
- **Branch + PR cadence.** Never commit to `main` (protected by the `protect-main` ruleset). Branch off `main`, open a PR, land via **rebase merge**, and keep the branch rebased on `main` so required checks run on the merged state.
- **Conventional Commits.** Commit messages must follow Conventional Commits (`type(scope): summary`, optional `!` for breaking changes). Use the footer for issue refs and required attribution, e.g. `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Required checks must pass before merge.** CI gates: `typecheck-and-test` and `smoke (M0 acceptance gate)`. Don't merge red. Postgres-integration tests are gated on `TEST_DATABASE_URL` (hermetic otherwise).
- **PR review = Codex.** Codex auto-reviews PRs and leaves inline comments graded P0/P1/P2. Read them; fix P1/P2 (P0 always); acknowledge with a 👍 reaction; re-push. **Resolve every review thread before merging — the `protect-main` ruleset requires it.** Codex does not auto re-review on push, so once checks are green and all threads are resolved, merge rather than waiting for a second pass.
- **PR descriptions: concise + implementation-focused.** A reviewer should be able to judge the *implementation* from the PR alone — cover briefly: a one/two-line intent, what changed, how it was verified, the acceptance it must meet, and the issue reference — `Closes #N` when the PR *fully* resolves the issue, or `Part of #N` / `Refs #N` for partial work (see *Umbrellas, sub-issues & closing keywords* above). Codex reads the diff + PR body (not the linked issues), so the body must be self-sufficient for *implementation* review — but keep it tight; don't paste the design into the PR (rationale/alternatives/decisions live in the issue or docs/tech-spec/, linked not reproduced). A PR reviews the code against a settled goal, not the design.
- **Design before code (`needs-design`).** Some issues carry the `needs-design` label: agree the design with the maintainer and record it in the issue (or a docs/tech-spec/ doc) *before* implementing. Design review happens there, in the design phase — not in the implementation PR.
- **Spec Kit harness.** Large features follow `docs/spec-kit-harness.md`; medium work records lightweight `Spec / Plan / Verify` in the issue; small fixes do not create spec artifacts.
- **Decision gating.** Proceed autonomously on small, well-scoped tasks; stop and ask the maintainer (with explicit options) on milestone, product, or architecture decisions — anything that changes scope, public surface, or a hard-to-reverse choice.
- **Spec-first + lockstep.** Weigh `docs/tech-spec/` before building; apply industry best practices; update spec and code together so they never drift.
- **Verification discipline.** Don't claim done without verification; verify UI changes in a real browser (not just a successful build); diagnose before fixing (observe → hypothesize → verify); state any verification you could not run.
- **Attribution.** End AI-assisted commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`; end PR descriptions with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Local dev for DB-backed work.** The gated Postgres integration tests need a local Postgres (e.g. colima + a `postgres:16` container) and `TEST_DATABASE_URL`; without it those tests skip.

### Running work in parallel (multiple agents)

When more than one agent/session works this repo at once, the goal is to minimise
coordination — isolate, claim, and integrate through artifacts (not chat):

- **One agent · one worktree · one issue.** Give each agent a dedicated `git worktree` (`git worktree add ../wt-<issue> -b <type>/<slug>-<issue> origin/main`); never run two agents in the same working tree — uncommitted WIP collides.
- **Claim before starting (lease).** First action on an issue: self-assign + add the `status:in-progress` label. Only pick issues that are unassigned, unblocked, and highest priority.
- **Dependencies are explicit.** Record `Depends on #N` (or use sub-issues); an issue is workable only once its dependencies are merged. Label work that's waiting `blocked`.
- **Decompose to be file-disjoint.** Scope parallel issues to different packages/dirs so they don't touch the same files; note `Touches:` paths on the issue. This is what makes parallelism actually faster (integration cost is superlinear when work overlaps).
- **Coordinate through artifacts, not chat.** Land shared-contract changes (schema, ports, public types) on `main` first; everyone else rebases. Agents don't talk to each other — the maintainer (or a lead/orchestrator session) is the bus.
- **Write in parallel, merge serially.** Required checks are strict (branch must be up to date), so merge the queue one PR at a time in dependency order; `auto-merge` + `allow_update_branch` handle the rebases.

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
