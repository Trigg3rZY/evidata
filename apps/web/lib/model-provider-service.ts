/**
 * ModelProviderService (epic #106) — manages BYO-key LLM providers behind the
 * MetadataStore + CredentialVault. The API key is encrypted on create (AAD = the
 * provider id) and decrypted only transiently here (when the agent resolves a
 * provider to run). Summaries never carry the blob. Mirrors ConnectionService.
 */
import { randomUUID } from 'node:crypto';
import { VaultUnavailableError } from '@evidata/connection';
import type { OpenAIProviderConfig } from '@evidata/provider-openai';
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

export { VaultUnavailableError };

/** The caller doesn't own the target provider (route → 404; no existence leak). */
export class ModelProviderAccessError extends Error {
  constructor() {
    super('Model provider not found.');
    this.name = 'ModelProviderAccessError';
  }
}

export interface CreateModelProviderInput {
  name: string;
  /** 'openai' | 'anthropic' | 'deepseek' | 'openai-compatible' | … */
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
  async list(userId: string): Promise<ModelProviderSummary[]> {
    const all = await this.deps.store.listModelProviders();
    return all.filter((p) => p.createdBy === userId);
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
    const baseURL = record.baseUrl ?? defaultBaseFor(record.kind);
    if (!baseURL) return null; // e.g. self-hosted with no baseUrl, or native Anthropic (later)
    const { apiKey } = JSON.parse(vault.decrypt(record.credentialBlob, record.id)) as {
      apiKey: string;
    };
    const config: OpenAIProviderConfig = { apiKey, baseURL, model: record.model };
    if (typeof record.params.maxTokens === 'number') config.maxTokens = record.params.maxTokens;
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
