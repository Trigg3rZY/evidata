/**
 * ModelProviderService (epic #106; team-shared #151) — manages the deployment's LLM
 * providers behind the MetadataStore + CredentialVault. Models are a **shared team
 * pool**: any authenticated member sees, selects, and runs every registered model;
 * only the member who configured one may delete it (`createdBy` = audit + delete
 * guard). The API key is encrypted on create (AAD = the provider id) and decrypted
 * only transiently on the resolve path. Summaries never carry the blob.
 */
import { randomUUID } from 'node:crypto';
import { VaultUnavailableError } from '@evidata/connection';
import type { OpenAIProviderConfig } from '@evidata/provider-openai';
import { isEffortLevel, kindSupportsEffort } from './model-kinds';
import type {
  CredentialVault,
  MetadataStore,
  ModelCapabilities,
  ModelParams,
  ModelProviderRecord,
  ModelProviderSummary,
} from '@evidata/ports';

/** Default OpenAI-compatible base URL for a provider kind (null = needs an explicit
 *  baseUrl, e.g. self-hosted; native non-OpenAI vendors like Anthropic come later). */
function defaultBaseFor(kind: string): string | null {
  switch (kind) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta/openai/';
    default:
      return null;
  }
}

/** The OpenAI-compatible base a provider would run against: its explicit baseUrl,
 *  else the vendor default. Null ⇒ not runnable (e.g. self-hosted / openai-compatible
 *  with no baseUrl, or a native vendor with no adapter yet). The single source of
 *  truth shared by resolveConfig (run) and list (the `runnable` flag). */
function resolvableBaseUrl(kind: string, baseUrl: string | null): string | null {
  return baseUrl ?? defaultBaseFor(kind);
}

export { VaultUnavailableError };

/** A listed provider plus whether it can actually run. A non-runnable provider
 *  would 404 on use (resolveConfig returns null), so the picker hides it; the admin
 *  list still shows it, flagged, so the owner can add a Base URL or delete it. */
export interface ModelProviderListItem extends ModelProviderSummary {
  runnable: boolean;
}

export interface ResolvedModelProvider {
  id: string;
  config: OpenAIProviderConfig;
}

/** The caller doesn't own the target provider (route → 404; no existence leak). */
export class ModelProviderAccessError extends Error {
  constructor() {
    super('Model provider not found.');
    this.name = 'ModelProviderAccessError';
  }
}

/** Result of a reachability probe (#119): a coarse status only — never the provider's
 *  response body, which could carry sensitive detail. `unconfigured` = no base URL
 *  resolves (same condition as `runnable: false`); `unauthorized` = the key was
 *  rejected; `unreachable` = the request never completed (DNS/network/timeout).
 *
 *  Scope note: this validates the base URL + key, NOT that the registered `model` name
 *  is accepted by chat/completions. A `GET /models` catalog check is unreliable for
 *  that — e.g. DeepSeek's catalog omits the valid `deepseek-chat` alias — and the only
 *  authoritative model check is a billable completion, out of scope for this cheap
 *  probe. So `ok` means "endpoint + key reachable", and a wrong model name still
 *  surfaces at ask time (resolveConfig → the run path). */
export type ModelProviderTestStatus =
  | 'ok'
  | 'unauthorized'
  | 'unreachable'
  | 'error'
  | 'unconfigured';
export interface ModelProviderTestResult {
  status: ModelProviderTestStatus;
  /** The provider's HTTP status for an `error`/`unauthorized` (a number is safe). */
  httpStatus?: number;
}

const PROBE_TIMEOUT_MS = 8000;

/** Probe an OpenAI-compatible endpoint with a cheap, token-free `GET /models` call —
 *  validates the base URL + key without spending a completion. Only the coarse outcome
 *  (and the numeric HTTP status) leaves this function — never the response body. */
async function probeModelProvider(
  baseURL: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ModelProviderTestResult> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch {
    return { status: 'unreachable' }; // never surface the thrown error (may leak the URL/key)
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return { status: 'ok' };
  if (res.status === 401 || res.status === 403)
    return { status: 'unauthorized', httpStatus: res.status };
  return { status: 'error', httpStatus: res.status };
}

export interface CreateModelProviderInput {
  name: string;
  /** An offered kind — see MODEL_KINDS ('openai' | 'deepseek' | 'google' |
   *  'openai-compatible'). Native non-OpenAI vendors are added with their adapter. */
  kind: string;
  baseUrl: string | null;
  model: string;
  params: ModelParams;
  capabilities: ModelCapabilities;
  /** Raw API key — encrypted at rest, never returned. */
  apiKey: string;
}

type ModelProviderStore = Pick<
  MetadataStore,
  'createModelProvider' | 'listModelProviders' | 'getModelProvider' | 'deleteModelProvider'
>;

export interface ModelProviderServiceDeps {
  store: ModelProviderStore;
  /** Null when APP_ENCRYPTION_KEY is unset — create/decrypt then error clearly. */
  vault: CredentialVault | null;
  newId?: (prefix: string) => string;
  /** Injectable for tests; defaults to the global fetch (the reachability probe). */
  fetchImpl?: typeof fetch;
}

export class ModelProviderService {
  private readonly newId: (prefix: string) => string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: ModelProviderServiceDeps) {
    this.newId = deps.newId ?? ((p) => `${p}_${randomUUID()}`);
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** Register a provider, encrypting its API key under AAD = the provider id. */
  async create(userId: string, input: CreateModelProviderInput): Promise<ModelProviderSummary> {
    const vault = this.requireVault();
    const id = this.newId('mp');
    const credentialBlob = vault.encrypt(JSON.stringify({ apiKey: input.apiKey }), id);
    const record = await this.deps.store.createModelProvider({
      id,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      model: input.model,
      params: input.params,
      capabilities: input.capabilities,
      credentialBlob,
      createdBy: userId,
    });
    return toSummary(record);
  }

  /** The team's shared model pool (summaries — never the key). Any authenticated
   *  member sees + can select/run every registered model (#151); `createdBy` is
   *  audit only, not an access gate. */
  async list(): Promise<ModelProviderListItem[]> {
    const all = await this.deps.store.listModelProviders();
    return all.map((p) => ({ ...p, runnable: resolvableBaseUrl(p.kind, p.baseUrl) !== null }));
  }

  /** Delete a shared model. It's selectable by everyone, but only the member who
   *  configured it (createdBy) may delete it — so nobody can pull the team's pool out
   *  from under others (#151). 404 for a non-creator / unknown (no leak). */
  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const record = await this.deps.store.getModelProvider(id);
    if (!record || record.createdBy !== userId) throw new ModelProviderAccessError();
    await this.deps.store.deleteModelProvider(id);
    return { ok: true };
  }

  /** Reachability/health probe for a shared model (#119): a quick key/endpoint check
   *  so a misconfigured model is visible before a question fails. Any authenticated
   *  member may test any shared model (#151); ephemeral (not persisted). 404 for an
   *  unknown id; `unconfigured` when no base URL resolves (nothing to probe). */
  async test(id: string): Promise<ModelProviderTestResult> {
    const vault = this.requireVault();
    const record = await this.deps.store.getModelProvider(id);
    if (!record) throw new ModelProviderAccessError();
    const baseURL = resolvableBaseUrl(record.kind, record.baseUrl);
    if (!baseURL) return { status: 'unconfigured' };
    const { apiKey } = JSON.parse(vault.decrypt(record.credentialBlob, record.id)) as {
      apiKey: string;
    };
    return probeModelProvider(baseURL, apiKey, this.fetchImpl);
  }

  /** Decrypt the API key for a provider — server-internal (the agent resolve path);
   *  never exposed by the API. Null if the provider is unknown. */
  async apiKeyFor(id: string): Promise<string | null> {
    const vault = this.requireVault();
    const record = await this.deps.store.getModelProvider(id);
    if (!record) return null;
    const { apiKey } = JSON.parse(vault.decrypt(record.credentialBlob, record.id)) as {
      apiKey: string;
    };
    return apiKey;
  }

  /** Resolve a shared model into a runnable provider config (decrypted key + base URL
   *  + model). Null if unknown or not yet runnable (an OpenAI-compatible base can't be
   *  determined). Shared (#151): any member — and a system-triggered rerun — can run any
   *  registered model; the key still flows only vault → provider, never to the client. */
  async resolveConfig(id: string): Promise<OpenAIProviderConfig | null> {
    const record = await this.deps.store.getModelProvider(id);
    if (!record) return null;
    return this.configFromRecord(record);
  }

  /** Resolve the deployment default: newest runnable registered model, or null when
   *  none exists. Used only when the client did not send an explicit selection. */
  async resolveDefaultConfig(): Promise<ResolvedModelProvider | null> {
    const summary = (await this.deps.store.listModelProviders()).find(
      (p) => resolvableBaseUrl(p.kind, p.baseUrl) !== null,
    );
    if (!summary) return null;
    const record = await this.deps.store.getModelProvider(summary.id);
    if (!record) return null;
    const config = this.configFromRecord(record);
    return config ? { id: record.id, config } : null;
  }

  private configFromRecord(record: ModelProviderRecord): OpenAIProviderConfig | null {
    const baseURL = resolvableBaseUrl(record.kind, record.baseUrl);
    if (!baseURL) return null; // e.g. self-hosted with no baseUrl, or native Anthropic (later)
    const vault = this.requireVault();
    const { apiKey } = JSON.parse(vault.decrypt(record.credentialBlob, record.id)) as {
      apiKey: string;
    };
    const config: OpenAIProviderConfig = { apiKey, baseURL, model: record.model };
    if (typeof record.params.maxTokens === 'number') config.maxTokens = record.params.maxTokens;
    if (
      record.capabilities.structuredOutput === true ||
      record.capabilities.toolChoice === 'none'
    ) {
      config.structuredOutput = true;
    }
    // Only pass effort for a kind that supports it AND a valid level. Registration
    // gates both now, but a record predating the gate (effort was once free text)
    // could hold e.g. 'extreme' on an openai record — drop it rather than send a
    // value the provider would reject.
    if (
      record.params.effort &&
      kindSupportsEffort(record.kind) &&
      isEffortLevel(record.params.effort)
    ) {
      config.effort = record.params.effort;
    }
    return config;
  }

  private requireVault(): CredentialVault {
    if (!this.deps.vault) throw new VaultUnavailableError();
    return this.deps.vault;
  }
}

/** Strip the encrypted blob — summaries are what leaves the service to the API. */
function toSummary(record: ModelProviderRecord): ModelProviderSummary {
  const { credentialBlob: _omit, ...summary } = record;
  return summary;
}
