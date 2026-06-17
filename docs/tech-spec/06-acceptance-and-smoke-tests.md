# 06 — M0 Acceptance & Smoke Tests

The exit gate for M0. M0 is "done" when this acceptance checklist passes and the smoke suite is green in CI. The suite runs with the `FixtureProvider` (hermetic, no model key) against the seeded pglite Sample.

PRD references: `Success Criteria`, `Success Measurement and Validation Signals` (guardrails), `Failure Criteria`, `Answer Contract`.

## 1. M0 acceptance checklist

A reviewer can, in a fresh checkout with `pnpm install && pnpm dev`:

- [ ] See the first-run/empty state, then the conversation-first Ask Data home with the Sample selected.
- [ ] Ask `acme-bill-up` and watch streamed reasoning collapse into a durable Answer with Evidence and expandable SQL.
- [ ] Expand an Evidence item; confirm Policy-bounded SQL, result summary, execution meta, policy notes.
- [ ] Ask a follow-up; confirm it appends a turn and a new Answer **version** (v2), with a "previous answers" entry to v1.
- [ ] Trigger `cross-area-reconcile`; confirm a `NoReliableAnswer` with an Unblock Path; use "pick a definition" to reach an answer; use "notify Admin" and see the Suggested acknowledgement.
- [ ] Trigger `needs-timerange`; confirm `NeedsClarification` with a time-range action.
- [ ] Confirm `mutation-attempt` is `BlockedByPolicy` (no write executed).
- [ ] Toggle language (en/zh) and theme (light/dark); confirm the four combinations render the golden path with no overflow/overlap.
- [ ] Operate the whole golden path by keyboard only; confirm focus states and `aria-live` reasoning.

## 2. Guardrail assertions (must pass — release blockers)

These encode PRD `Success Measurement → Guardrail Signals`:

```
G1 read-only        : for every scenario, all executed statements pass SafetyGate as SELECT;
                      `mutation-attempt` produces 0 executed writes and status BlockedByPolicy.
G2 no secrets to LLM : spy on AgentProvider input — assert no credentials/secret fields and no
                      values from sensitive columns (accounts.contact_email) ever appear; only
                      RedactedResult crosses.
G3 evidence-cited    : for every Answered/Partial result, validateAnswer() returns [] and every
                      KeyFinding.evidenceIds resolves to a recorded Evidence item.
G4 every-run-recorded: EvidenceRecorder.record called once per executed query; counts match.
```

## 3. Contract tests

```
C1 schema-sync      : generate JSON schema from answer-contract.ts and assert it equals the
                      committed answer-contract.schema.json (no drift).
C2 legality         : property test over AnswerStatus × Confidence — isLegalStatusConfidence and
                      the JSON schema agree for all 20 combinations.
C3 unblock-required : any Answer with status != Answered and no `unblock` fails validateAnswer
                      AND fails schema validation.
C4 answered-findings: status Answered with 0 keyFindings fails validateAnswer.
C5 versioning       : a follow-up increments version, sets createdAfter, flips isLatest; prior
                      versions remain retrievable (no overwrite).
```

## 4. End-to-end smoke specs (Playwright, per scenario)

Each scenario from spec 05 has an e2e test asserting the contract-level outcome, not pixels:

```
E-acme-bill-up:
  POST /api/investigations {sample, "Why is ACME's ad bill higher this month?"}
  stream: >=1 reasoning event, >=2 query events, terminal answer
  answer.status == "Answered"; confidence in {High,Medium}; confidenceReason non-empty
  answer.keyFindings.length >= 2; each cites existing evidence
  answer.evidence[].sql present and parses as read-only
  UI: Evidence collapsed by default, expandable; SQL visible on expand

E-followup-version:
  after acme-bill-up, POST /turns {"break down Summer Sale by day"}
  new answer.meta.version == 2; createdAfter.kind == "followup"; v1 still GET-able

E-cross-area-reconcile:
  answer.status == "NoReliableAnswer"
  answer.unblock.whatsMissing[].kind includes "unverified_mapping"
  answer.unblock.nextSteps[].kind includes "notify_admin_verify" with createsSuggestion
  click pick_definition choice -> follow-up answer becomes Answered/Partial
  click notify_admin_verify -> POST /suggestions returns recorded

E-needs-timerange:
  answer.status == "NeedsClarification"; confidence == "CannotDetermine"
  unblock.nextSteps[].kind includes "set_time_range"

E-mutation-blocked:
  answer.status == "BlockedByPolicy"; 0 writes executed (G1)
  unblock.nextSteps[].kind includes "view_mutation_draft"

E-sensitive-redaction:
  evidence references contact_email -> listed in redactedColumns; a caveat notes redaction (G2)
```

## 5. Rendering matrix (Playwright)

```
R-matrix: for lang in {en, zh-CN} × theme in {light, dark}:
  render EmptyState, an Answered thread, and an Unblock thread;
  assert no horizontal overflow, no overlapping bounding boxes on golden-path nodes,
  and AA contrast on text/background tokens.
```

## 6. Accessibility checks

```
A11y-keyboard : tab through the golden path; every interactive control reachable & operable.
A11y-axe      : run axe-core on EmptyState + Answer thread; 0 serious/critical violations.
A11y-live     : reasoning container has aria-live="polite"; final answer move does not steal focus.
```

## 7. CI wiring

- `pnpm test:unit` → Vitest (contract tests C1–C5, SafetyGate rule tests, Redactor tests, guardrail unit checks G2–G4).
- `pnpm test:smoke` → Playwright (E-*, R-matrix, A11y-*) with `AGENT_PROVIDER=fixture`.
- Both run on every PR; the smoke suite is the M0 acceptance gate. Merging to `main` requires green.

## 8. Definition of Done (M0)

M0 is complete when: the acceptance checklist (§1) is demonstrably true, §2–§6 are green in CI, the Answer Contract artifacts are in lockstep (C1), and a reviewer agrees the trusted-answer loop "feels trustworthy" on the Sample. That judgment — plus the green gate — is the signal to start M1.
