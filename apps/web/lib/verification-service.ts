/**
 * Context verification (M2-B3, #122, spec 09 §3/§5) — the owner reviews Suggested
 * glossary terms + entity mappings (e.g. AI calibration drafts) and promotes them to
 * **Verified**, edits a definition, or rejects (deletes) them. Only Verified items
 * reach the Ask model (the resolver filters to status='verified'), so this is the
 * human gate between a draft and a live answer. Gated by the `author` capability
 * (owner/admin) via the Data Source role matrix (spec 09 §6). Every mutation is scoped
 * by dataSourceId, so an item id from another source can't be touched.
 */
import { randomUUID } from 'node:crypto';
import type {
  EntityMappingRecord,
  GlossaryTermRecord,
  MetadataStore,
  NewEntityMapping,
  NewGlossaryTerm,
} from '@evidata/ports';
import { requireDataSourceCapability } from './authoring-service';

export type ContextItemKind = 'glossary' | 'mapping';

export interface ContextItems {
  glossary: GlossaryTermRecord[];
  mappings: EntityMappingRecord[];
}

/** Invalid verification input (e.g. an empty definition) — route → 400. */
export class VerificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationValidationError';
  }
}

type VerificationStore = Pick<
  MetadataStore,
  | 'getDataSource'
  | 'getDataSourceRole'
  | 'getGlossaryTerms'
  | 'getEntityMappings'
  | 'addGlossaryTerms'
  | 'addEntityMappings'
  | 'setGlossaryStatus'
  | 'updateGlossaryTerm'
  | 'updateGlossaryDefinition'
  | 'deleteGlossaryTerm'
  | 'setEntityMappingStatus'
  | 'updateEntityMapping'
  | 'deleteEntityMapping'
>;

const requiredText = (value: string, message: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new VerificationValidationError(message);
  return trimmed;
};

export class VerificationService {
  constructor(
    private readonly store: VerificationStore,
    private readonly newId: (prefix: string) => string = (prefix) => `${prefix}_${randomUUID()}`,
  ) {}

  /** All glossary terms + mappings for the source (every status, with ids). */
  async list(userId: string, dataSourceId: string): Promise<ContextItems> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    const [glossary, mappings] = await Promise.all([
      this.store.getGlossaryTerms(dataSourceId),
      this.store.getEntityMappings(dataSourceId),
    ]);
    return { glossary, mappings };
  }

  /** Owner/admin-authored glossary terms are verified immediately. */
  async addGlossaryTerm(
    userId: string,
    dataSourceId: string,
    input: { term: string; definition: string },
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    const term = requiredText(input.term, 'A term is required.');
    const definition = requiredText(input.definition, 'A definition is required.');
    const row: NewGlossaryTerm = {
      id: this.newId('gls'),
      dataSourceId,
      term,
      definition,
      status: 'verified',
      provenance: 'admin',
    };
    await this.store.addGlossaryTerms([row]);
  }

  /** Owner/admin-authored entity mappings are verified immediately. */
  async addEntityMapping(
    userId: string,
    dataSourceId: string,
    input: { fromRef: string; toRef: string },
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    const fromRef = requiredText(input.fromRef, 'A from reference is required.');
    const toRef = requiredText(input.toRef, 'A to reference is required.');
    const row: NewEntityMapping = {
      id: this.newId('map'),
      dataSourceId,
      fromRef,
      toRef,
      status: 'verified',
      provenance: 'admin',
    };
    await this.store.addEntityMappings([row]);
  }

  /** Promote a Suggested item to Verified (it becomes visible to the Ask model). */
  async promote(
    userId: string,
    dataSourceId: string,
    kind: ContextItemKind,
    id: string,
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    if (kind === 'glossary') await this.store.setGlossaryStatus(dataSourceId, id, 'verified');
    else await this.store.setEntityMappingStatus(dataSourceId, id, 'verified');
  }

  /** Reject (delete) an item. */
  async reject(
    userId: string,
    dataSourceId: string,
    kind: ContextItemKind,
    id: string,
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    if (kind === 'glossary') await this.store.deleteGlossaryTerm(dataSourceId, id);
    else await this.store.deleteEntityMapping(dataSourceId, id);
  }

  /** Edit a glossary definition (refine an AI draft before verifying). */
  async editGlossary(
    userId: string,
    dataSourceId: string,
    id: string,
    definition: string,
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    await this.store.updateGlossaryDefinition(
      dataSourceId,
      id,
      requiredText(definition, 'A definition is required.'),
    );
  }

  /** Edit a glossary term + definition without changing its status. */
  async editGlossaryTerm(
    userId: string,
    dataSourceId: string,
    id: string,
    input: { term: string; definition: string },
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    await this.store.updateGlossaryTerm(dataSourceId, id, {
      term: requiredText(input.term, 'A term is required.'),
      definition: requiredText(input.definition, 'A definition is required.'),
    });
  }

  /** Edit an entity mapping without changing its status. */
  async editEntityMapping(
    userId: string,
    dataSourceId: string,
    id: string,
    input: { fromRef: string; toRef: string },
  ): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    await this.store.updateEntityMapping(dataSourceId, id, {
      fromRef: requiredText(input.fromRef, 'A from reference is required.'),
      toRef: requiredText(input.toRef, 'A to reference is required.'),
    });
  }
}
