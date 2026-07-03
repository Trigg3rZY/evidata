# Spec Kit Harness

Status: active working policy
Language: en

This harness decides when evidata uses Spec Kit and when a normal issue + PR is
enough. It exists to keep roadmap-sized work tied to product intent without
turning every polish fix into a document project.

Official references:

- Installation: <https://github.github.com/spec-kit/installation.html>
- Quickstart: <https://github.github.com/spec-kit/quickstart.html>
- Integrations: <https://github.github.com/spec-kit/reference/integrations.html>
- Evolving specs: <https://github.com/github/spec-kit/blob/main/docs/guides/evolving-specs.md>

## Work size

### Small

Use a GitHub issue and a normal PR. Do not create a spec artifact.

Small work is a bug fix, copy fix, local friction polish, or test-only change
that fits in one PR and does not change product scope, public API, data model,
permissions, trust boundaries, or architecture.

### Medium

Use a GitHub issue with a lightweight `Spec / Plan / Verify` section. Do not add
repo specs unless the decision needs to outlive the issue.

Medium work changes local UX, API behavior, or implementation shape, but is
still one focused feature or one to two PRs. If the issue has `needs-design`,
record the agreed design in the issue before coding.

### Large

Use full Spec Kit.

Large work includes roadmap capabilities, milestone work, multi-PR features,
cross-module changes, durable data-model or API changes, trust-boundary changes,
or anything that needs user stories and acceptance criteria before the
implementation is safe to split.

## Project baselines

Do not create a second project-level data model or user-story document. Use
these sources as the baseline, and add only feature-level deltas in each large
feature spec:

- Product goals and user stories: `docs/prd.en.md`, `docs/roadmap.en.md`
- Domain model and names: `docs/glossary.en.md`
- As-built data model: `docs/tech-spec/10-m0-data-model-and-persistence.md`,
  `docs/tech-spec/12-m1-data-model.md`,
  `docs/tech-spec/09-m2-calibration-publishing-and-roles.md`
- Trust boundary: `docs/tech-spec/01-architecture.md`,
  `docs/tech-spec/02-answer-contract.md`,
  `docs/tech-spec/03-agent-and-safety.md`,
  `docs/tech-spec/06-acceptance-and-smoke-tests.md`

If a feature exposes a missing baseline concept, update the smallest baseline
document that owns that concept.

## Large-feature flow

Use the official Spec Kit flow for large features:

1. `constitution`
2. `specify`
3. `clarify`
4. `plan`
5. `checklist`
6. `tasks`
7. `analyze`
8. implementation PRs
9. `converge`

Use flow-forward specs by default: each large feature keeps its own historical
spec directory. Do not rewrite old feature specs except to mark them superseded.

## Evidata gates

Every spec, plan, task split, and implementation must preserve these gates:

- AI proposes; application code validates, executes, redacts, records, and
  persists.
- Only controlled read-only SQL may execute.
- SafetyGate, executor bounds, redaction, QueryRun, and Evidence recording are
  mandatory for data claims.
- Connection credentials, raw secrets, provider payloads, PII, and unredacted
  result rows must not reach the model, client, logs, or persisted evidence.
- Verified context is the only durable context treated as reliable.
- Membership is not authorization; Data Source and Connection permissions stay
  separate.
- Product metadata stays in evidata metadata storage, never in user business
  databases.

## Spec Kit setup policy

Install Spec Kit only from the official `github/spec-kit` repository and pin a
release tag. Do not use unrelated packages with the same name.

Preferred setup:

```sh
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.12.4
specify init --here --integration codex --script sh --force
```

If the pinned CLI does not support Codex integration, use the official generic
integration and record the fallback in this file.

After running `specify init --here --force`, inspect the generated diff and
preserve project-specific instructions in `AGENTS.md`,
`.specify/memory/constitution.md`, and existing `docs/`.

## First large feature

The first Spec Kit feature is Data Source authoring IA:

- Include: #176 sectioned authoring layout and #174 searchable grouped
  table/column selector.
- Exclude: #173 ER diagram, #175 per-conversation Data Source picker, and #188
  manual glossary/mapping editing.
- Keep the existing authoring payload and metadata schema unless the spec proves
  a change is necessary.
- Produce a prototype image or browser prototype before frontend implementation.
