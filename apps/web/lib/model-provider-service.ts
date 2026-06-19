/**
 * ModelProviderService (epic #106) — manages BYO-key LLM providers behind the
 * MetadataStore + CredentialVault. The API key is encrypted on create (AAD = the
 * provider id) and decrypted only transiently here (when the agent resolves a
 * provider to run). Summaries never carry the blob. Mirrors ConnectionService.
 */
import { randomUUID } from 'node:crypto';
import { VaultUnavailableError } from '@evidata/connection';
import type {
  CredentialVault,
  MetadataStore,
  ModelCapabilities,
  ModelParams,
  ModelProviderRecord,
  ModelProviderSummary,
} from '@evidata/ports';

export { VaultUnavailableError };

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

  /** Public summaries for the picker / admin UI (never the key). */
  list(): Promise<ModelProviderSummary[]> {
    return this.deps.store.listModelProviders();
  }

  async remove(id: string): Promise<{ ok: true }> {
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
