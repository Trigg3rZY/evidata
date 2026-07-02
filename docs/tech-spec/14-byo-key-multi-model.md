# 14 — BYO-key Multi-model (epic #106)

As-built record of the multi-model layer. evidata must not be locked to `deepseek-chat`:
a deployment registers **multiple models** (each with its own key) as a **shared team
pool**, and every member **picks the model** (and, where the model supports it, the
**reasoning effort**) per conversation. Keys are still bring-your-own — they're just
shared across the team rather than private per user (revised in #151).

Safety is **model-independent** — the application validates, executes (read-only),
redacts, records, and persists; the model only proposes (`01 §4`, `13 §7`). So "any
model" does **not** weaken the trust guarantees; this is purely an integration/config
concern.

## 1. Provider layer (Vercel AI SDK behind `AgentProvider`)

The agent loop, Safety Gate, Redactor, and evidence/G3 guarantees are untouched. Only
the transport changed: `@evidata/provider-openai` runs on the **Vercel AI SDK**
(`generateText`) behind the existing `AgentProvider` port.

- `sdk-transport.ts` implements the `Complete` contract via
  `createOpenAICompatible(...)` + `generateText`. One OpenAI-compatible path covers
  most vendors (OpenAI, DeepSeek, Google's OpenAI endpoint, Mistral, Together, Groq,
  Ollama, vLLM, self-hosted). Tool calls, usage, streaming, and transient retry come
  from the SDK.
- DeepSeek tool-argument JSON repair (unescaped quotes / control chars) is preserved
  via `experimental_repairToolCall` + the shared `json-repair.ts` (see
  `[[deepseek-provider-reliability]]` history; `13`).
- **Adapter cost model:** adding a *model* = a registry record (zero code). A *new
  wire protocol* (e.g. Anthropic's Messages API) needs at most **one adapter per
  protocol family** (not per model), and most such vendors also expose OpenAI-compat
  endpoints, so the adapter is often skippable.

## 2. Model registry (team-shared, vault-encrypted)

Mirrors Connections (`08 §3/§6`). Table `model_providers` (migration `0004`):
`{ id, name, kind, baseUrl, model, params, capabilities, credentialBlob, createdBy }`.

- **Keys encrypted at rest** by the same `CredentialVault` as DB connection creds
  (AES-256-GCM, AAD = the provider id). The raw key is never returned, logged, or put
  in a summary. Decrypted only transiently on the resolve path.
- **Team-shared (#151):** every authenticated member **sees, selects, and runs** every
  registered model; `createdBy` is **audit + a delete guard** only — a model is selectable
  by all, but only the member who configured it may delete it (404 for a non-creator /
  unknown id, no existence leak). The original per-user scoping was revised for the
  self-hosted-team product (one place to manage the team's keys; members don't each need
  their own).
- `kind` ∈ `openai | deepseek | google | openai-compatible`. A kind maps to a default
  OpenAI-compatible base URL (`openai`→api.openai.com/v1, `deepseek`→api.deepseek.com,
  `google`→…/v1beta/openai/); `openai-compatible` and self-hosted require an explicit
  Base URL. **Native non-OpenAI vendors (e.g. Anthropic's Messages API) are not offered
  yet** — they need a per-protocol adapter, and routing them through the
  openai-compatible transport would fail at runtime; a kind is added when its adapter
  lands (§7). An Anthropic *OpenAI-compatible proxy* works today as `openai-compatible`.
- **Runnable flag:** `list()` derives `runnable` = "a base URL resolves" (explicit or
  vendor default), sharing `resolveConfig`'s logic. The picker offers only runnable
  models; the admin list shows the rest flagged "Needs base URL".

API: `GET/POST /api/model-providers`, `DELETE /api/model-providers/:id`, `POST
/api/model-providers/:id/test` (session-gated; list/select/run/test are shared, delete is
creator-only). Admin UI: `/admin/models` (mirrors `/admin/connections`), under a shared
Connections/Models sub-nav.

## 3. Selection & binding (per Investigation)

Decision A: **per-conversation selection + a registered default**, mirroring the
data-source picker — not mid-conversation switching, not app-wide-only.

- A top-nav `ModelPicker` lists the shared pool's runnable models and sends
  `modelProviderId` on a **new** turn. It auto-selects the first runnable registered
  model and hides when no models are registered.
- **Bound per Investigation (#113):** `investigations.model_provider_id` (migration
  `0005`, nullable, no FK so the audit id survives provider deletion) records the model
  at creation. A **follow-up resolves the stored model** (ignores the client's current
  picker) so a conversation never switches models mid-thread.
- **No silent fallback (#111/#170):** a selected-but-unresolvable model (deleted or no
  base URL) returns **404**. If no `modelProviderId` is sent, the server binds the newest
  runnable registered model. If no registered model exists, real Data Source asks return
  a clear **409**; only anonymous Sample asks may use the FixtureProvider.
- `null` binding = fixture-backed anonymous Sample or a legacy unbound row. Real model
  runs bind a registered provider id and store an immutable registered-model audit
  snapshot (#116).

## 4. Reasoning effort (gated by kind — decision B)

`lib/model-kinds.ts` is the single source of truth (kinds, effort levels
`low|medium|high`, the effort gate) shared by the create API, admin UI, and
`resolveConfig`.

- **Only `openai` kind is effort-capable today** — OpenAI's reasoning models accept
  `reasoning_effort`; DeepSeek (chat *and* reasoner) has no effort knob, and native
  Anthropic/Google effort isn't exposed through the openai-compatible transport. A
  self-hosted reasoner that speaks the OpenAI reasoning API registers as `openai` + a
  custom Base URL.
- The create API rejects effort for a non-effort kind and an out-of-range value; the
  admin Effort field is a `low/medium/high` select shown only for effort-capable kinds.
  `resolveConfig` re-checks `kindSupportsEffort` + `isEffortLevel` (drops invalid legacy
  free-text values).
- Applied via the openai-compatible provider's `providerOptions.openaiCompatible.
  reasoningEffort` → the `reasoning_effort` request field.

## 5. Trust boundary (extends `01 §4`, `13 §7`)

Unchanged by model choice: only read-only SQL executes (`SafetyGate`), only
redacted/bounded results reach the model, every Key Finding cites recorded Evidence
(G3), every executed query is a recorded QueryRun (G4). The model — whichever one — only
proposes. Keys flow straight from the vault to the provider; they never reach the model,
client, logs, or persisted evidence.

## 6. Configuration

- `APP_ENCRYPTION_KEY` (base64 of 32 bytes) enables the `CredentialVault` — **required**
  to register connections or models. Without it, create/decrypt surface a clear "not
  configured" error (503). Rotation via `APP_ENCRYPTION_KEYS` + `APP_ENCRYPTION_KEY_ID`
  (`08 §3`).
- Real model runs are configured by registering a `ModelProvider` in `/admin/models`.
  The prior single-model env path is removed; unset/empty model registry means
  anonymous Sample uses the deterministic FixtureProvider, while real Data Source asks
  fail fast.

## 7. Deferred (forward-compat)

Gated on having a non-DeepSeek key to exercise:

- **Native non-OpenAI adapters** (e.g. Anthropic via `@ai-sdk/anthropic`) — skipped for
  now; one adapter per protocol family when needed.
- **Capability-aware A/B execution** — strategy A (forced tool-calling, current) for
  models with `tool_choice`; strategy B (structured-output + validate + retry) for
  reasoning/no-tool models.
- **Provider status/health** — an owner-gated reachability "Test" shipped in `/admin/models`
  (#119); a per-pick health hint in the picker is still deferred.
- **Native provider-level default ordering controls** — today default means newest
  runnable registered model.

## 8. Tests

`model-provider-service` (encrypt / shared-pool + creator-only delete / resolve / runnable
/ effort / reachability probe), `model-kinds`
(kind + effort gate), `sdk-transport` (effort reaches `reasoning_effort` on the wire),
`ask-stream` (`modelProviderId` parsing), store + `InvestigationService` (per-
Investigation binding). The picker, effort gating, and per-Investigation binding were
browser-verified against real DeepSeek (the `usage` SSE frame, which the fixture never
emits, is the discriminator for "ran on the registered model").
