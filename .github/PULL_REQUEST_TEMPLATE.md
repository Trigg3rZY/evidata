<!-- Conventions: see AGENTS.md → "Collaboration & workflow". -->

## What & why

<!-- Summary. Link the issue this closes, e.g. "Closes #123". -->

## Checklist

- [ ] Branched off `main`; landing via **rebase merge** (never push to `main`)
- [ ] Required checks green: `typecheck-and-test` + `smoke (M0 acceptance gate)`
- [ ] Codex review comments addressed (P0/P1/P2) and acknowledged
- [ ] Spec kept in lockstep (`docs/tech-spec/`) if behavior/contract changed
- [ ] Verified — tests run; **real-browser check for UI**; noted anything not run
- [ ] Trust boundary intact: AI proposes; the app validates / executes (read-only) / redacts / records
- [ ] Attribution footers added for AI-assisted changes (see AGENTS.md)
