# CLAUDE.md

Project conventions for AI agents live in **[AGENTS.md](AGENTS.md)** — the
cross-tool source of truth (Codex and other agents read it directly). It is
imported below so a Claude Code session loads it from the repo, independent of any
private/per-session memory.

@AGENTS.md

> Maintainer-personal preferences (e.g. conversation language, how learning notes
> are captured) are intentionally **not** in this shared repo — they live in the
> operator's private assistant memory.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses Matt Pocock's five default state labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.
