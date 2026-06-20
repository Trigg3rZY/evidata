# 14 — BYO-key Multi-model (epic #106)

As-built record of the bring-your-own-key, multi-model layer. evidata is BYO-key:
each deployer/user brings **their own** model API key(s) and must not be locked to
`deepseek-chat`. A user registers **multiple models** (each with its own key), then
**picks the model** (and, where the model supports it, the **reasoning effort**) per
conversation.

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

## 2. Model registry (per-user, vault-encrypted)

Mirrors Connections (`08 §3/§6`). Table `model_providers` (migration `0004`):
`{ id, name, kind, baseUrl, model, params, capabilities, credentialBlob, createdBy }`.

- **Keys encrypted at rest** by the same `CredentialVault` as DB connection creds
  (AES-256-GCM, AAD = the provider id). The raw key is never returned, logged, or put
  in a summary. Decrypted only transiently on the resolve path.
- **Per-user (BYO-key):** a caller only sees/manages/runs **their own** providers
  (`createdBy`); cross-user access 404s (no existence leak).
- `kind` ∈ `openai | deepseek | google | openai-compatible | anthropic`. A kind maps to
  a default OpenAI-compatible base URL (`openai`→api.openai.com/v1,
  `deepseek`→api.deepseek.com, `google`→…/v1beta/openai/); `openai-compatible` and
  self-hosted require an explicit Base URL. `anthropic` is registrable for
  forward-compat but **not yet runnable** (no native adapter — deferred).
- **Runnable flag:** `list()` derives `runnable` = "a base URL resolves" (explicit or
  vendor default), sharing `resolveConfig`'s logic. The picker offers only runnable
  models; the admin list shows the rest flagged "Needs base URL".

API: `GET/POST /api/model-providers`, `DELETE /api/model-providers/:id` (session-gated,
owner-scoped). Admin UI: `/admin/models` (mirrors `/admin/connections`), under a shared
Connections/Models sub-nav.

## 3. Selection & binding (per Investigation)

Decision A: **per-conversation selection + a default**, mirroring the data-source
picker — not mid-conversation switching, not app-wide-only.

- A top-nav `ModelPicker` ("Default model" + the user's runnable models) sends
  `modelProviderId` on a **new** turn. Hidden when the user has no registered models.
- **Bound per Investigation (#113):** `investigations.model_provider_id` (migration
  `0005`, nullable, no FK so the audit id survives provider deletion) records the model
  at creation. A **follow-up resolves the stored model** (ignores the client's current
  picker) so a conversation never switches models mid-thread.
- **No silent fallback (#111):** a selected-but-unresolvable model (deleted, not owned,
  no base URL) returns **404** — only the no-selection case uses the env/fixture
  default.
- `null` binding = the deployment's **env-configured default** (simple single-model
  deploy). It is **not** snapshotted, so a default-bound follow-up uses the current env
  default; an immutable env-default audit snapshot is tracked as **#116**.

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
- The single-model **env path** still works for simple deploys (`AGENT_PROVIDER=openai`
  + `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`AGENT_MODEL`); unset → the deterministic
  FixtureProvider (dev/CI). See `.env.example`.

## 7. Deferred (forward-compat)

Gated on having a non-DeepSeek key to exercise:

- **Native non-OpenAI adapters** (e.g. Anthropic via `@ai-sdk/anthropic`) — skipped for
  now; one adapter per protocol family when needed.
- **Capability-aware A/B execution** — strategy A (forced tool-calling, current) for
  models with `tool_choice`; strategy B (structured-output + validate + retry) for
  reasoning/no-tool models.
- **Provider status/health** in the picker.
- **Env-default audit snapshot** (#116).

## 8. Tests

`model-provider-service` (encrypt/own-scope/resolve/runnable/effort), `model-kinds`
(kind + effort gate), `sdk-transport` (effort reaches `reasoning_effort` on the wire),
`ask-stream` (`modelProviderId` parsing), store + `InvestigationService` (per-
Investigation binding). The picker, effort gating, and per-Investigation binding were
browser-verified against real DeepSeek (the `usage` SSE frame, which the fixture never
emits, is the discriminator for "ran on the registered model").
