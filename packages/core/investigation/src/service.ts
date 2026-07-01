/**
 * InvestigationService — drives one Ask Data turn end to end (spec 01 §3):
 * create the Investigation, run the AgentRunner (streaming events to a sink),
 * and persist the validated Answer with its QueryRun/Evidence provenance.
 *
 * Framework-agnostic: the Next.js route (a later PR) adapts this to HTTP/SSE.
 */
import { randomUUID } from 'node:crypto';
import {
  AgentRunner,
  type AgentContext,
  type AgentMessage,
  type AgentProvider,
  type AgentRunEvent,
  type ConversationTurn,
} from '@evidata/agent';
import type { Answer, InvestigationWithAnswers } from '@evidata/answer-contract';
import type {
  Connector,
  InvestigationListItem,
  ListOpts,
  MetadataStore,
  ModelSnapshot,
  Redactor,
  SafetyContext,
  SafetyGate,
  SchemaSnapshot,
} from '@evidata/ports';

/** Everything needed to run the loop against one Data Source (M0: the Sample). */
export interface DataSourceRuntime {
  id: string;
  name: string;
  connector: Connector;
  safetyContext: SafetyContext;
  schema: SchemaSnapshot;
  /** Verified-only context handed to the provider. */
  context: AgentContext;
}

/**
 * Resolves a Data Source not in the static `dataSources` list into a runtime on
 * demand — e.g. a *published* real Postgres source (spec 09 §2). The static array
 * is checked first; this is the fallback. Keeps the AgentRunner unchanged: the
 * resolved runtime feeds the same loop as the built-in Sample.
 */
export interface DataSourceResolver {
  /** Published, runnable sources the user may access (beyond the static ones).
   *  Without a user, real sources are withheld (only static sources are open). */
  list(userId?: string): Promise<Array<{ id: string; name: string }>>;
  /** Build a runtime for a source id, or null if it isn't published/runnable OR the
   *  user isn't authorized for it (owner-gated for the slice — spec 09 §2). */
  resolve(
    id: string,
    userId?: string,
    purpose?: 'ask' | 'overview',
  ): Promise<DataSourceRuntime | null>;
}

export interface InvestigationServiceDeps {
  dataSources: DataSourceRuntime[];
  gate: SafetyGate;
  redactor: Redactor;
  store: MetadataStore;
  /** Optional: resolve non-static (e.g. published real) sources on demand. */
  resolver?: DataSourceResolver;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

export interface AskParams {
  dataSourceId: string;
  question: string;
  language: 'en' | 'zh-CN';
  /** The authenticated user (server-injected, never client-supplied): authorizes
   *  access to a real published source. Omit for the open Sample. */
  userId?: string;
  /** Continue an existing Investigation (a follow-up): append a new Answer version
   *  and seed the model with prior turns. Omit to start a new Investigation. */
  investigationId?: string;
  /** Regenerate the latest answer: append a version with NO new user turn and
   *  versionTrigger 'rerun' (requires investigationId). */
  rerun?: boolean;
  /** A correction-loop rerun (M2-B4): like `rerun`, but the appended version records
   *  versionTrigger 'definition_correction' (an Admin accepted a Verified edit that
   *  affects this answer). Implies `rerun`. */
  correction?: boolean;
  /** Optimistic head guard (M2-B4 ②): append the new version only if the head is still
   *  this version at save time; otherwise the save throws (a follow-up moved the head). */
  expectedLatestVersion?: number;
  /** The model to bind to a NEW Investigation (epic #106 / #113). Recorded on
   *  create; null/omitted = the server's default. Ignored for a follow-up — that
   *  reuses the Investigation's already-bound model (the caller resolves it). */
  modelProviderId?: string | null;
  /** Immutable audit snapshot of the effective model, recorded on a NEW Investigation
   *  (#116). Captures which model/endpoint answered even on the env-default path. */
  modelSnapshot?: ModelSnapshot | null;
}

export interface AskOptions {
  provider: AgentProvider;
  sink?: (event: AgentRunEvent) => void;
  /** Cancels the in-flight turn (client Stop / disconnect). An aborted run persists nothing. */
  signal?: AbortSignal;
}

/**
 * One turn's outcome: an evidence-backed Answer (persisted, versioned), or a
 * conversational Message (greeting / drafted SQL / decline — spec 13). M0 keeps
 * Messages ephemeral: they make no data claim, so they are streamed and shown but
 * not persisted (no Investigation row, no version chain).
 */
export type AskResult =
  | { kind: 'answer'; investigationId: string; answer: Answer }
  | { kind: 'message'; message: AgentMessage };

/**
 * Read-only overview of a Data Source for the Data Sources view (spec 04 §1):
 * structural + trust facts only. It never exposes internals — no credentials,
 * connector handles, or executor (the Sample has none; M1's Connection creds
 * stay on the Connection, never copied here).
 */
export interface DataSourceSafetyPosture {
  /** The execution boundary is read-only by construction (spec 01 §4). */
  readOnly: true;
  rowLimit: number;
  timeoutMs: number;
  /** Sensitive columns the Redactor masks, as "table.column". */
  redactedColumns: string[];
}

export interface DataSourceOverview {
  id: string;
  name: string;
  schema: SchemaSnapshot;
  safety: DataSourceSafetyPosture;
}

function deriveTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

/**
 * Reconstruct ordered (question → Direct Answer) pairs from a stored thread, to
 * seed a follow-up's model context. Walks turns in order, pairing each user
 * question with its agent answer version. A rerun (agent turn with no preceding
 * user turn) replaces the previous pair's answer with the newer version, so a
 * later follow-up sees the latest regenerated answer, not the stale one (#56).
 */
function priorTurns(inv: InvestigationWithAnswers): ConversationTurn[] {
  const byVersion = new Map(inv.answers.map((a) => [a.meta.version, a]));
  const turns: ConversationTurn[] = [];
  let pendingQuestion: string | undefined;
  for (const t of inv.turns) {
    if (t.role === 'user') {
      pendingQuestion = t.question;
    } else if (t.role === 'agent' && t.answerVersion !== undefined) {
      const answer = byVersion.get(t.answerVersion);
      if (!answer?.directAnswer) continue;
      if (pendingQuestion !== undefined) {
        turns.push({ question: pendingQuestion, answer: answer.directAnswer });
        pendingQuestion = undefined;
      } else if (turns.length > 0) {
        // Rerun: latest version for the prior question.
        turns[turns.length - 1] = {
          question: turns[turns.length - 1]!.question,
          answer: answer.directAnswer,
        };
      }
    }
  }
  return turns;
}

export class InvestigationService {
  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;

  constructor(private readonly deps: InvestigationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  /** Available Data Sources for the picker (no internals leaked): the static
   *  sources plus any the resolver exposes for this user (published real sources
   *  they may access), deduped. */
  async listDataSources(userId?: string): Promise<Array<{ id: string; name: string }>> {
    const seen = new Map<string, { id: string; name: string }>();
    for (const d of this.deps.dataSources) seen.set(d.id, { id: d.id, name: d.name });
    if (this.deps.resolver) {
      for (const d of await this.deps.resolver.list(userId)) if (!seen.has(d.id)) seen.set(d.id, d);
    }
    return [...seen.values()];
  }

  /** Read-only overview for the Data Sources view (spec 04 §1): schema + trust
   *  posture only, never credentials/connector internals. Null if unknown or the
   *  user isn't authorized for a real source. */
  async getDataSourceOverview(id: string, userId?: string): Promise<DataSourceOverview | null> {
    const rt = await this.resolveOrNull(id, userId);
    if (!rt) return null;
    return {
      id: rt.id,
      name: rt.name,
      schema: rt.schema,
      safety: {
        readOnly: true,
        rowLimit: rt.safetyContext.policy.rowLimit,
        timeoutMs: rt.safetyContext.policy.timeoutMs,
        redactedColumns: [...rt.safetyContext.sensitiveColumns],
      },
    };
  }

  /**
   * Run one turn. With `params.investigationId` it's a **follow-up**: the prior
   * turns seed the model (resolve "it"/"why?") and `saveAnswer` appends the next
   * Answer version to that Investigation (the store is authoritative for the
   * version + the single is_latest head). Otherwise it starts a new Investigation.
   * A conversational Message is ephemeral either way (no persistence).
   */
  async ask(params: AskParams, opts: AskOptions): Promise<AskResult> {
    const isFollowup = !!params.investigationId;
    const isRerun = Boolean((params.rerun || params.correction) && params.investigationId);
    let rt: DataSourceRuntime;
    let investigationId: string;
    let question = params.question;
    let history: ConversationTurn[] = [];
    let priorAnswers: ReadonlyArray<Answer> = [];
    if (params.investigationId) {
      // A follow-up is a user action → scope by owner (IDOR). A correction rerun is a
      // privileged system flow (an Admin accepted it) → unscoped; `ask` then appends by id.
      const prior = isRerun
        ? await this.deps.store.getInvestigationUnchecked(params.investigationId)
        : await this.deps.store.getInvestigation(params.investigationId, params.userId);
      if (!prior) throw new Error(`Unknown investigation: ${params.investigationId}`);
      // The data source is bound for the Investigation's lifetime — run against the
      // STORED one, not the client-supplied params.dataSourceId (which a follow-up
      // request may omit or get wrong).
      rt = await this.dataSource(prior.dataSourceId, params.userId, 'ask');
      investigationId = prior.id;
      history = priorTurns(prior);
      priorAnswers = prior.answers;
      if (isRerun) {
        // A rerun regenerates the latest question authoritatively: use the latest
        // STORED user turn (ignore a stale client-sent question), and drop that turn
        // from the context so the model re-answers it fresh against the earlier turns.
        const lastQuestion = [...prior.turns].reverse().find((t) => t.role === 'user')?.question;
        if (lastQuestion) question = lastQuestion;
        history = history.slice(0, -1);
      }
    } else {
      rt = await this.dataSource(params.dataSourceId, params.userId, 'ask');
      investigationId = this.newId('inv');
    }

    const runner = new AgentRunner({
      provider: opts.provider,
      connector: rt.connector,
      gate: this.deps.gate,
      redactor: this.deps.redactor,
      safetyContext: rt.safetyContext,
      dataSourceName: rt.name,
      now: this.now,
      newId: this.newId,
      ...(opts.sink ? { sink: opts.sink } : {}),
      // Drive the runner's version stamping so the answer records its audit
      // provenance (createdAfter: { kind, fromVersion }); the store still re-stamps
      // the authoritative version/isLatest.
      ...(priorAnswers.length
        ? {
            priorAnswers,
            versionTrigger: isRerun
              ? params.correction
                ? ('definition_correction' as const)
                : ('rerun' as const)
              : ('followup' as const),
          }
        : {}),
    });

    // Run first, persist after: a cancelled turn (RunAbortedError) throws here and
    // nothing is written — no orphan Investigation (spec 13 §4). For a new turn the
    // id is generated (not persisted), so it can still appear on streamed evidence.
    const result = await runner.run(
      {
        investigationId,
        question,
        language: params.language,
        schema: rt.schema,
        context: rt.context,
        ...(history.length ? { history } : {}),
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    // A conversational Message makes no data claim — ephemeral, nothing persisted.
    if (result.kind === 'message') {
      return { kind: 'message', message: result.message };
    }

    // New Investigation: create the row. A follow-up appends to the existing one.
    if (!isFollowup) {
      await this.deps.store.createInvestigation({
        id: investigationId,
        dataSourceId: rt.id,
        title: deriveTitle(params.question),
        // Bind the chosen registered model for the Investigation's lifetime (#113).
        // null = the deployment's env-configured default (the simple single-model
        // path): a follow-up then uses the current env default.
        modelProviderId: params.modelProviderId ?? null,
        // Immutable audit snapshot of the model that actually answered (#116) — durable
        // even for the env-default path, where modelProviderId is null.
        modelSnapshot: params.modelSnapshot ?? null,
        // Owner scoping (#177): null = anonymous (Sample). Threaded from the
        // authenticated userId already in AskParams; drives list/get isolation.
        ownerId: params.userId ?? null,
      });
    }

    // saveAnswer is authoritative for versioning: it appends version N+1 and demotes
    // the prior head. A rerun OMITS `question` so no duplicate user turn is recorded
    // (it regenerates the existing turn's answer); a normal turn records the question.
    const answer = await this.deps.store.saveAnswer({
      investigationId,
      ...(isRerun ? {} : { question: params.question }),
      answer: result.answer,
      queryRuns: result.queryRuns,
      ...(params.expectedLatestVersion != null
        ? { expectedLatestVersion: params.expectedLatestVersion }
        : {}),
    });

    return { kind: 'answer', investigationId, answer };
  }

  getThread(id: string, userId?: string): Promise<InvestigationWithAnswers | null> {
    return this.deps.store.getInvestigation(id, userId);
  }
  /** Trusted internal read (no owner scoping) — for the correction rerun, which acts
   *  on a known investigationId from the DB. User reads use `getThread` (#177). */
  getThreadUnchecked(id: string): Promise<InvestigationWithAnswers | null> {
    return this.deps.store.getInvestigationUnchecked(id);
  }

  /** The model bound to an Investigation (epic #106 / #113), or null if none/unknown.
   *  Lets the HTTP layer resolve a follow-up against the Investigation's bound model
   *  instead of the client's current selection. */
  getInvestigationModelProviderId(id: string): Promise<string | null> {
    return this.deps.store.getInvestigationModelProviderId(id);
  }

  list(opts?: ListOpts, userId?: string): Promise<InvestigationListItem[]> {
    return this.deps.store.listInvestigations({ ...(opts ?? {}), ...(userId ? { userId } : {}) });
  }

  /** Static-first lookup; falls back to the resolver. Throws if unknown/unrunnable
   *  or the user isn't authorized (the error is generic — no existence leak). */
  private async dataSource(
    id: string,
    userId?: string,
    purpose?: 'ask' | 'overview',
  ): Promise<DataSourceRuntime> {
    const rt = await this.resolveOrNull(id, userId, purpose);
    if (!rt) throw new Error(`Unknown data source: ${id}`);
    return rt;
  }

  /** Static-first lookup (static sources are open); resolver fallback (authorized
   *  per userId); null if neither yields a runtime. */
  private async resolveOrNull(
    id: string,
    userId?: string,
    purpose?: 'ask' | 'overview',
  ): Promise<DataSourceRuntime | null> {
    const stat = this.deps.dataSources.find((d) => d.id === id);
    if (stat) return stat;
    return this.deps.resolver ? this.deps.resolver.resolve(id, userId, purpose) : null;
  }
}
