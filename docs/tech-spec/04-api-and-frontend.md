# 04 — API & Frontend (M0)

The HTTP/SSE surface for M0 and the React frontend that renders the conversation-first experience. The UI mirrors `../prototypes/prototype.html`; this turns that prototype into a component contract.

PRD references: `Interaction Model`, `Navigation and First Screen`, `Language and Theme Requirements` (incl. a11y baseline), `Answer Contract`.

## 1. API surface (M0)

All routes are Next.js App Router route handlers under `apps/web/app/api`. JSON in, JSON or SSE out. Auth in M0 is a single local dev identity (real auth is M1).

| Method & path | Purpose | Response |
|---|---|---|
| `GET /api/data-sources` | List selectable Data Sources (M0: Sample). | `DataSourceListItem[]` |
| `GET /api/data-sources/:id` | Overview: what it can/can't answer, examples. | `DataSourceOverview` |
| `POST /api/investigations` | Start a new Investigation (new thread). Body: `{ dataSourceId, question }`. Opens SSE. | `text/event-stream` |
| `POST /api/investigations/:id/turns` | Follow-up in an existing thread. Body: `{ question }` or `{ unblockActionId, choiceId }`. Opens SSE. | `text/event-stream` |
| `POST /api/investigations/:id/rerun` | Rerun latest (new version, no user turn). Opens SSE. | `text/event-stream` |
| `GET /api/investigations` | History rail. Query: `limit`, `cursor`. | `InvestigationListItem[]` |
| `GET /api/investigations/:id` | Full thread incl. all Answer versions. | `InvestigationWithAnswers` |
| `POST /api/investigations/:id/suggestions` | Record a Suggested correction (correction loop / Unblock). | `{ id, status: 'recorded' }` |

Types come from `@evidata/answer-contract` (`packages/core/answer-contract/src/answer-contract.ts`). `404`/permission responses follow PRD `Application States` (no existence leak beyond Policy).

### 1.1 SSE event stream

`Content-Type: text/event-stream`. Each event is `event: <type>\ndata: <json>\n\n`. Event types match `03 §6`:

```
event: reasoning
data: {"label":"Resolving customer identity (ACME)"}

event: query
data: {"purpose":"Compare total spend across periods","status":"running"}

event: query
data: {"purpose":"Compare total spend across periods","status":"ok","rowCount":2,"elapsedMs":84}

event: answer
data: { ...full Answer object per the contract... }

event: done
data: {}
```

`need_input` (clarification/Unblock) and `error` (product-level) are also valid terminal-ish events. **M0 note:** the route does not emit a separate `need_input` event — a non-`Answered` result (incl. its `UnblockPath`) is carried in the final `answer` payload, which the client renders accordingly; `need_input` is reserved for a future interactive-pause flow. The client renders `reasoning`/`query` as the transient progress block, then replaces it with the `answer` payload. Aborting the request (`AbortController`) should cancel the turn server-side via a `signal` passed to `AgentProvider` — the M0 route is disconnect-safe (writes stop on cancel) but does not yet abort the in-flight runner (the agent contract has no `AbortSignal` yet; tracked as a follow-up).

## 2. Frontend component tree

Mirrors the prototype. Client components unless noted.

```
<AppShell>                         theme + lang providers, data-theme on <html>
├─ <Sidebar>                       history rail (primary surface)
│   ├─ <NewInvestigationButton/>
│   ├─ <HistoryList/>              grouped Today / Earlier; GET /api/investigations
│   └─ <SecondaryNav/>            Data Sources, settings (secondary)
├─ <TopBar>                        breadcrumb + <LangToggle/> + <ThemeToggle/>
└─ <AskData>                       default home
    ├─ <EmptyState/>              centered greeting + <Composer variant="hero"/>
    │   ├─ <SampleQuestionCards/>
    │   └─ <RecentInvestigations/>
    └─ <InvestigationThread/>     active thread
        ├─ <Turn role="user"/>
        ├─ <AgentTurn/>
        │   ├─ <StreamedReasoning/>     consumes reasoning/query SSE
        │   └─ <AnswerView/>           renders the Answer contract
        │       ├─ <StatusRow/>        status + confidence + reason
        │       ├─ <DirectAnswer/>
        │       ├─ <WhatIDid/>         collapsible
        │       ├─ <KeyFindings/>      each with <EvidenceRef/> chips
        │       ├─ <EvidenceList/>     <EvidenceItem/> w/ collapsed SQL, table
        │       ├─ <Assumptions/> <Caveats/>
        │       ├─ <UnblockPathView/>  when status !== Answered
        │       ├─ <QuickActions/>     rerun / handoff / copy / (roadmap) playbook
        │       ├─ <Followups/>        chips -> append follow-up turn
        │       └─ <VersionFooter/>    vN · latest · previous answers
        └─ <Composer variant="dock"/>  pinned; submit = follow-up turn
```

Each surface maps to a shadcn/Radix component (`StatusRow` → `Badge`, Evidence SQL → `Collapsible`, the data-source picker → `Command`, the mutation-draft view → `Dialog`, …); the full mapping is in `11-m0-design-system.md §7`. `AnswerView` is a pure function of one `Answer` object — the same object the smoke tests validate. `UnblockPathView` renders `whatsMissing` + `nextSteps`; action buttons call the relevant API (`/turns` with `unblockActionId`/`choiceId`, or `/suggestions` for `createsSuggestion` actions) and, for `pick_definition`/`pick_candidate`, expand inline choices that submit a follow-up.

## 3. Client state

- **Server state**: React Query (TanStack) for `data-sources`, `investigations`, thread fetch. SSE is consumed by a small `useInvestigationStream` hook that appends `reasoning`/`query` events to a transient buffer and, on `answer`, invalidates the thread query so the durable Answer is the source of truth (no divergence between streamed and persisted state).
- **Follow-up appends**: submitting from the dock composer or a follow-up chip POSTs `/turns` and opens a new stream appended to the thread — matching the prototype's append behavior and the contract's version increment.
- No `localStorage` for domain data; only UI prefs (lang/theme) may persist client-side.

## 4. i18n

- `packages/i18n` holds typed catalogs `en` and `zh-CN`; keys are a const map so missing keys fail the build (the prototype's 165-key catalog is the starting set).
- Static UI chrome uses catalog keys. **AI answer content** is not translated client-side: per PRD it is authored in the question's language and arrives as resolved `LocalizedText` in the Answer.
- Language toggle switches catalog + `<html lang>`; does not retranslate existing answers.

## 5. Styling & theming

- **Tailwind CSS v4 + shadcn/ui** (Radix primitives, owned in `apps/web/components/ui`); icons via lucide-react. The full visual language — tokens, the Status × Confidence system, typography, density modes, and the component mapping — is specified in `11-m0-design-system.md`.
- Theme tokens are CSS custom properties (shadcn semantic vars + a layered status set); `data-theme="light|dark"` on `<html>`.
- All four combinations (en/zh × light/dark) are a render-test matrix in spec 06.

## 6. Accessibility baseline (V1, enforced in M0)

- Full keyboard operation of the golden path: composer (submit, data-source picker), thread navigation, expanding Evidence/SQL, Unblock actions, quick actions.
- Semantic roles/labels: the thread is a `log`/`feed`; streamed reasoning uses `aria-live="polite"` so it is announced without stealing focus; collapsibles use `disclosure` semantics; the composer is a labelled form.
- WCAG AA contrast in all four combinations (token choices verified).
- Visible focus states; no focus traps; respects `prefers-reduced-motion` (the streamed-reasoning spinner degrades to static).

## 7. Mapping to PRD UI Failure Criteria

The component contract is built to avoid the PRD's listed failures: durable `AnswerView` (not ephemeral chat), Evidence/SQL always reachable, Data-Source selector secondary to asking, no provider/debug surfaces, and the four-combination render matrix in CI.
