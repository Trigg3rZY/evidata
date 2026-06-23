/**
 * SuggestionService — the M2-B4 correction-loop review (#123, spec 09 §3).
 *
 * A querier raises a correction from a *blocked* answer's Unblock Path (`submit`,
 * gated on `query` — a member of the source); an owner/admin reviews the queue
 * (`list`/`accept`/`reject`, gated on `author`). Because the Unblock Path carries no
 * structured item id, the reviewer resolves which Suggested glossary term / mapping
 * the correction maps to at accept time; `accept` then promotes that item to Verified
 * (reusing the B3 VerificationService) and records the resolution. The PRD invariant
 * holds: a querier never mutates Verified context — only an owner/admin promotes.
 *
 * The auto-rerun of the affected investigation is a separate step (B4 ②); `accept`
 * returns the investigationId so the caller can drive it.
 */
import { randomUUID } from 'node:crypto';
import type {
  MetadataStore,
  SuggestionStatus,
  SuggestionTargetKind,
  SuggestionView,
} from '@evidata/ports';
import { canDataSource } from './authz';
import { AuthoringAccessError, requireDataSourceCapability } from './authoring-service';
import { VerificationService } from './verification-service';

/** Invalid submit input (route → 400). */
export class SuggestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuggestionValidationError';
  }
}

/** The suggestion is no longer open — already accepted/rejected (route → 409). */
export class SuggestionStateError extends Error {
  constructor() {
    super('This suggestion has already been reviewed.');
    this.name = 'SuggestionStateError';
  }
}

type SuggestionStore = Pick<
  MetadataStore,
  // direct
  | 'getInvestigation'
  | 'getDataSource'
  | 'getDataSourceRole'
  | 'createSuggestion'
  | 'listSuggestions'
  | 'getSuggestion'
  | 'setSuggestionReviewed'
  // delegated to VerificationService (the accept path)
  | 'getGlossaryTerms'
  | 'getEntityMappings'
  | 'setGlossaryStatus'
  | 'setEntityMappingStatus'
  | 'deleteGlossaryTerm'
  | 'deleteEntityMapping'
  | 'updateGlossaryDefinition'
>;

export interface SubmitSuggestionInput {
  /** The UnblockActionKind that created it (e.g. 'notify_admin_verify'). */
  kind: string;
  /** Human ref from the unblock (e.g. 'invoices.customer_ref→accounts.id'). */
  targetRef?: string | null;
  description: string;
  /** Optional: the definition the querier proposes (for an ambiguous term). */
  proposedDefinition?: string | null;
}

export interface AcceptSuggestionInput {
  /** Which Suggested item the reviewer mapped this correction to. */
  targetKind: SuggestionTargetKind;
  targetItemId: string;
  /** Optional new definition to apply before verifying a glossary term. */
  definition?: string | null;
}

export class SuggestionService {
  private readonly verification: VerificationService;
  private readonly newId: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(
    private readonly store: SuggestionStore,
    opts?: { newId?: (prefix: string) => string; now?: () => Date },
  ) {
    this.verification = new VerificationService(store);
    this.newId = opts?.newId ?? ((p) => `${p}_${randomUUID()}`);
    this.now = opts?.now ?? (() => new Date());
  }

  /** A querier submits a correction from a blocked answer (gated on `query`). */
  async submit(
    userId: string,
    investigationId: string,
    input: SubmitSuggestionInput,
  ): Promise<{ id: string }> {
    const inv = await this.store.getInvestigation(investigationId);
    if (!inv) throw new AuthoringAccessError();
    const dataSourceId = inv.dataSourceId;
    const role = await this.store.getDataSourceRole(userId, dataSourceId);
    if (!canDataSource(role, 'query')) throw new AuthoringAccessError();

    const description = input.description.trim();
    if (!description) throw new SuggestionValidationError('A description is required.');

    const id = this.newId('sug');
    await this.store.createSuggestion({
      id,
      investigationId,
      dataSourceId,
      answerVersion: inv.answers.at(-1)?.meta.version ?? null,
      kind: input.kind,
      targetRef: input.targetRef?.trim() || null,
      description,
      proposedDefinition: input.proposedDefinition?.trim() || null,
      submittedBy: userId,
    });
    return { id };
  }

  /** Owner/admin: the source's review queue (gated on `author`). */
  async list(
    userId: string,
    dataSourceId: string,
    status: SuggestionStatus = 'open',
  ): Promise<SuggestionView[]> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    return this.store.listSuggestions(dataSourceId, status);
  }

  /**
   * Accept: promote the reviewer-chosen Suggested item to Verified (B3), then mark the
   * suggestion accepted. Returns the affected investigationId for the rerun (B4 ②).
   */
  async accept(
    userId: string,
    dataSourceId: string,
    suggestionId: string,
    input: AcceptSuggestionInput,
  ): Promise<{ investigationId: string }> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    const sug = await this.store.getSuggestion(suggestionId);
    if (!sug || sug.dataSourceId !== dataSourceId) throw new AuthoringAccessError();
    if (sug.status !== 'open') throw new SuggestionStateError();

    // Apply the Verified edit. promote/editGlossary re-check `author` (harmless) and are
    // scoped by dataSourceId, so a target id from another source is a no-op.
    if (input.targetKind === 'glossary') {
      if (input.definition && input.definition.trim()) {
        await this.verification.editGlossary(
          userId,
          dataSourceId,
          input.targetItemId,
          input.definition,
        );
      }
      await this.verification.promote(userId, dataSourceId, 'glossary', input.targetItemId);
    } else {
      await this.verification.promote(userId, dataSourceId, 'mapping', input.targetItemId);
    }

    await this.store.setSuggestionReviewed(dataSourceId, suggestionId, {
      status: 'accepted',
      targetKind: input.targetKind,
      targetItemId: input.targetItemId,
      reviewedBy: userId,
      reviewedAt: this.now(),
    });
    return { investigationId: sug.investigationId };
  }

  /** Reject a suggestion (gated on `author`). */
  async reject(userId: string, dataSourceId: string, suggestionId: string): Promise<void> {
    await requireDataSourceCapability(this.store, userId, dataSourceId, 'author');
    const sug = await this.store.getSuggestion(suggestionId);
    if (!sug || sug.dataSourceId !== dataSourceId) throw new AuthoringAccessError();
    if (sug.status !== 'open') throw new SuggestionStateError();
    await this.store.setSuggestionReviewed(dataSourceId, suggestionId, {
      status: 'rejected',
      reviewedBy: userId,
      reviewedAt: this.now(),
    });
  }
}
