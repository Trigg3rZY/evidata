# Security Policy

evidata is an evidence-backed AI data portal. We treat product trust boundaries
as first-class — see [AGENTS.md](AGENTS.md) and
[docs/tech-spec/03-agent-and-safety.md](docs/tech-spec/03-agent-and-safety.md).

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue or PR.

Use GitHub's private vulnerability reporting:
**[Security → Report a vulnerability](https://github.com/Trigg3rZY/evidata/security/advisories/new)**.

Include the affected component, reproduction steps, and impact. We aim to
acknowledge within a few days and will coordinate a fix and disclosure with you.

## What to look at first

The highest-severity areas mirror the product's trust boundary:

- **SQL execution safety** — only read-only queries may execute; `SafetyGate`,
  executor bounds, and QueryRun/Evidence recording are mandatory.
- **Secret handling** — DB connection strings and BYO provider API keys are
  encrypted at rest; they must never reach the model, client, logs, or evidence.
- **Data leakage** — raw rows, PII, provider payloads, and stack traces must be
  redacted out of anything the model, client, or persisted evidence can see.

## Supported versions

evidata is pre-1.0 and under active development; only `main` is supported.
