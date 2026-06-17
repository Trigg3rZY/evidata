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
  type AgentProvider,
  type AgentRunEvent,
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
}

export interface AskOptions {
  provider: AgentProvider;
  sink?: (event: AgentRunEvent) => void;
}

export interface AskResult {
  investigationId: string;
  answer: Answer;
}

function deriveTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
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

  // M0: `ask` always starts a new Investigation (single-turn). Follow-ups/reruns
  // — loading prior answers, passing `priorAnswers`/`versionTrigger` to the
  // runner so the store appends version N — land with the thread UI.
  async ask(params: AskParams, opts: AskOptions): Promise<AskResult> {
    const rt = this.dataSource(params.dataSourceId);
    const investigationId = this.newId('inv');

    await this.deps.store.createInvestigation({
      id: investigationId,
      dataSourceId: rt.id,
      title: deriveTitle(params.question),
    });

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
    });

    const result = await runner.run({
      investigationId,
      question: params.question,
      language: params.language,
      schema: rt.schema,
      context: rt.context,
    });

    const answer = await this.deps.store.saveAnswer({
      investigationId,
      question: params.question,
      answer: result.answer,
      queryRuns: result.queryRuns,
    });

    return { investigationId, answer };
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
