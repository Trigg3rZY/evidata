/**
 * ModelProviderService (epic #106) — manages BYO-key LLM providers behind the
 * MetadataStore + CredentialVault. The API key is encrypted on create (AAD = the
 * provider id) and decrypted only transiently here (when the agent resolves a
 * provider to run). Summaries never carry the blob. Mirrors ConnectionService.
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

/** The caller doesn't own the target provider (route → 404; no existence leak). */
export class ModelProviderAccessError extends Error {
  constructor() {
    super('Model provider not found.');
    this.name = 'ModelProviderAccessError';
  }
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
}

export class ModelProviderService {
  private readonly newId: (prefix: string) => string;

  constructor(private readonly deps: ModelProviderServiceDeps) {
    this.newId = deps.newId ?? ((p) => `${p}_${randomUUID()}`);
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

  /** The caller's own providers (summaries — never the key). Providers are
   *  per-user (BYO-key): a caller never sees or manages another user's. */
  async list(userId: string): Promise<ModelProviderListItem[]> {
    const all = await this.deps.store.listModelProviders();
    return all
      .filter((p) => p.createdBy === userId)
      .map((p) => ({ ...p, runnable: resolvableBaseUrl(p.kind, p.baseUrl) !== null }));
  }

  /** Delete one of the caller's own providers; 404 for a non-owner (no leak). */
  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const record = await this.deps.store.getModelProvider(id);
    if (!record || record.createdBy !== userId) throw new ModelProviderAccessError();
    await this.deps.store.deleteModelProvider(id);
    return { ok: true };
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

  /** Resolve one of the caller's own providers into a runnable provider config
   *  (decrypted key + base URL + model). Null if not owned, unknown, or not yet
   *  runnable (an OpenAI-compatible base can't be determined). Owner-gated so a
   *  caller can only run with their own key. */
  async resolveConfig(userId: string, id: string): Promise<OpenAIProviderConfig | null> {
    const vault = this.requireVault();
    const record = await this.deps.store.getModelProvider(id);
    if (!record || record.createdBy !== userId) return null;
    const baseURL = resolvableBaseUrl(record.kind, record.baseUrl);
    if (!baseURL) return null; // e.g. self-hosted with no baseUrl, or native Anthropic (later)
    const { apiKey } = JSON.parse(vault.decrypt(record.credentialBlob, record.id)) as {
      apiKey: string;
    };
    const config: OpenAIProviderConfig = { apiKey, baseURL, model: record.model };
    if (typeof record.params.maxTokens === 'number') config.maxTokens = record.params.maxTokens;
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
