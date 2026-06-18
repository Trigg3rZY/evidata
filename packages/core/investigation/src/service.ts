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

export interface InvestigationServiceDeps {
  dataSources: DataSourceRuntime[];
  gate: SafetyGate;
  redactor: Redactor;
  store: MetadataStore;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

export interface AskParams {
  dataSourceId: string;
  question: string;
  language: 'en' | 'zh-CN';
  /** Continue an existing Investigation (a follow-up): append a new Answer version
   *  and seed the model with prior turns. Omit to start a new Investigation. */
  investigationId?: string;
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

function deriveTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

/**
 * Reconstruct ordered (question → Direct Answer) pairs from a stored thread, to
 * seed a follow-up's model context. Walks turns in order, pairing each user
 * question with the next agent turn's answer version (by `meta.version`).
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
      if (pendingQuestion && answer?.directAnswer) {
        turns.push({ question: pendingQuestion, answer: answer.directAnswer });
      }
      pendingQuestion = undefined;
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

  /** Available Data Sources for the picker (no internals leaked). */
  listDataSources(): Array<{ id: string; name: string }> {
    return this.deps.dataSources.map((d) => ({ id: d.id, name: d.name }));
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
    let rt: DataSourceRuntime;
    let investigationId: string;
    let history: ConversationTurn[] = [];
    let priorAnswers: ReadonlyArray<Answer> = [];
    if (params.investigationId) {
      const prior = await this.deps.store.getInvestigation(params.investigationId);
      if (!prior) throw new Error(`Unknown investigation: ${params.investigationId}`);
      // The data source is bound for the Investigation's lifetime — run against the
      // STORED one, not the client-supplied params.dataSourceId (which a follow-up
      // request may omit or get wrong).
      rt = this.dataSource(prior.dataSourceId);
      investigationId = prior.id;
      history = priorTurns(prior);
      priorAnswers = prior.answers;
    } else {
      rt = this.dataSource(params.dataSourceId);
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
      // Drive the runner's version stamping so a follow-up records its audit
      // provenance (createdAfter: { kind: 'followup', fromVersion }); the store
      // still re-stamps the authoritative version/isLatest.
      ...(priorAnswers.length ? { priorAnswers, versionTrigger: 'followup' as const } : {}),
    });

    // Run first, persist after: a cancelled turn (RunAbortedError) throws here and
    // nothing is written — no orphan Investigation (spec 13 §4). For a new turn the
    // id is generated (not persisted), so it can still appear on streamed evidence.
    const result = await runner.run(
      {
        investigationId,
        question: params.question,
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
      });
    }

    // saveAnswer is authoritative for versioning: it appends version N+1 and demotes
    // the prior head, and records the user/agent turns for this question.
    const answer = await this.deps.store.saveAnswer({
      investigationId,
      question: params.question,
      answer: result.answer,
      queryRuns: result.queryRuns,
    });

    return { kind: 'answer', investigationId, answer };
  }

  getThread(id: string): Promise<InvestigationWithAnswers | null> {
    return this.deps.store.getInvestigation(id);
  }

  list(opts?: ListOpts): Promise<InvestigationListItem[]> {
    return this.deps.store.listInvestigations(opts);
  }

  private dataSource(id: string): DataSourceRuntime {
    const rt = this.deps.dataSources.find((d) => d.id === id);
    if (!rt) throw new Error(`Unknown data source: ${id}`);
    return rt;
  }
}
