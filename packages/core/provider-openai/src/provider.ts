/**
 * OpenAI-compatible AgentProvider (spec 03 §7). Drives the tool-use loop: each
 * `next()` turn the model calls exactly one tool, which we map to an
 * AgentDecision. The AgentRunner still owns the SafetyGate, execution, redaction,
 * recording, and validation — this adapter only translates.
 *
 * Stateful per run (one instance per Investigation turn): it owns the chat
 * transcript and feeds back each redacted tool result. Configurable for any
 * OpenAI-compatible endpoint (DeepSeek by default).
 */
import type {
  AgentDecision,
  AgentHistory,
  AgentInput,
  AgentProvider,
  AnswerDraft,
  ToolResult,
} from '@evidata/agent';
import type { Confidence, KeyFinding, MissingInfo, MissingKind } from '@evidata/answer-contract';
import { AGENT_TOOLS, buildSystemPrompt } from './tools';
import type {
  AssistantMessage,
  ChatMessage,
  Complete,
  CompletionRequest,
  OpenAIProviderConfig,
} from './types';

const MISSING_KINDS: ReadonlySet<string> = new Set<MissingKind>([
  'business_object',
  'time_range',
  'authorization',
  'mutation_required',
  'ambiguous_definition',
  'unverified_mapping',
  'insufficient_results',
]);
const CONFIDENCES: ReadonlySet<string> = new Set<Confidence>([
  'High',
  'Medium',
  'Low',
  'CannotDetermine',
]);

const asString = (u: unknown): string => (typeof u === 'string' ? u : '');
const asArray = (u: unknown): unknown[] => (Array.isArray(u) ? (u as unknown[]) : []);
const asRecord = (u: unknown): Record<string, unknown> =>
  typeof u === 'object' && u !== null ? (u as Record<string, unknown>) : {};

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
}

function unblock(kind: MissingKind, description: string): AgentDecision {
  return { kind: 'unblock', missing: [{ kind, description }] };
}

function toMissing(u: unknown): [MissingInfo, ...MissingInfo[]] {
  const items: MissingInfo[] = [];
  for (const entry of asArray(u)) {
    const r = asRecord(entry);
    const kind = asString(r.kind);
    if (MISSING_KINDS.has(kind))
      items.push({ kind: kind as MissingKind, description: asString(r.description) });
  }
  return items.length
    ? (items as [MissingInfo, ...MissingInfo[]])
    : [{ kind: 'insufficient_results', description: 'No reliable answer could be produced.' }];
}

function toKeyFindings(u: unknown): KeyFinding[] {
  const findings: KeyFinding[] = [];
  for (const entry of asArray(u)) {
    const r = asRecord(entry);
    const ids = asArray(r.evidenceIds).map(asString).filter(Boolean);
    if (ids.length)
      findings.push({ text: asString(r.text), evidenceIds: ids as [string, ...string[]] });
  }
  return findings;
}

function toDraft(args: Record<string, unknown>): AnswerDraft {
  const confidence = asString(args.confidence);
  const draft: AnswerDraft = {
    status: args.status === 'Partial' ? 'Partial' : 'Answered',
    directAnswer: asString(args.directAnswer),
    confidence: CONFIDENCES.has(confidence) ? (confidence as Confidence) : 'Medium',
    confidenceReason: asString(args.confidenceReason),
    keyFindings: toKeyFindings(args.keyFindings),
  };
  const assumptions = asArray(args.assumptions)
    .map((a) => ({ text: asString(asRecord(a).text) }))
    .filter((a) => a.text);
  if (assumptions.length) draft.assumptions = assumptions;
  const caveats = asArray(args.caveats).map(asString).filter(Boolean);
  if (caveats.length) draft.caveats = caveats;
  const followups = asArray(args.recommendedFollowups)
    .map((f) => ({ question: asString(asRecord(f).question) }))
    .filter((f) => f.question);
  if (followups.length) draft.recommendedFollowups = followups;
  return draft;
}

/** What the model sees as a tool result: the redacted, bounded result only. */
function resultForModel(tr: ToolResult): Record<string, unknown> {
  if (tr.error) return { purpose: tr.purpose, error: tr.error };
  return {
    evidenceRef: tr.evidenceRef,
    purpose: tr.purpose,
    columns: tr.columns.map((c) => c.name),
    rowCount: tr.rowCount,
    truncated: tr.truncated,
    sampleRows: tr.sampleRows,
    redactedColumns: tr.redactedColumns,
  };
}

interface ChatResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: AssistantMessage['tool_calls'] };
  }>;
}

/** Default transport: a plain typed POST to an OpenAI-compatible `/chat/completions`. */
export function fetchComplete(cfg: OpenAIProviderConfig): Complete {
  const base = cfg.baseURL.replace(/\/+$/, '');
  return async (req: CompletionRequest, opts) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(req),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}`);
    const data = (await res.json()) as ChatResponse;
    const msg = data.choices?.[0]?.message;
    return {
      content: msg?.content ?? null,
      ...(msg?.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    };
  };
}

export class OpenAIAgentProvider implements AgentProvider {
  private readonly complete: Complete;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly messages: ChatMessage[] = [];
  private started = false;
  private pendingCallId: string | undefined;
  private pendingFinalCallId: string | undefined;
  private consumed = 0;

  constructor(cfg: OpenAIProviderConfig, complete?: Complete) {
    this.complete = complete ?? fetchComplete(cfg);
    this.model = cfg.model;
    this.maxTokens = cfg.maxTokens ?? 1024;
  }

  // NOTE: `signal` is accepted for forward-compatibility but the AgentRunner does
  // not thread one yet, so an in-flight request isn't cancelled on disconnect —
  // wiring AbortSignal end to end is the tracked M1 follow-up (08 §2.1).
  async next(
    input: AgentInput,
    history: AgentHistory,
    signal?: AbortSignal,
  ): Promise<AgentDecision> {
    if (!this.started) {
      this.messages.push({ role: 'system', content: buildSystemPrompt(input) });
      this.messages.push({ role: 'user', content: input.question });
      this.started = true;
    }

    // Feed back the previous run_sql's redacted result. The runner pushes exactly
    // one result per `query` decision before calling next() again, so the newest
    // toolResult is the one this pendingCallId is waiting on.
    if (this.pendingCallId && history.toolResults.length > this.consumed) {
      const tr = history.toolResults[history.toolResults.length - 1]!;
      this.messages.push({
        role: 'tool',
        tool_call_id: this.pendingCallId,
        content: JSON.stringify(resultForModel(tr)),
      });
      this.consumed = history.toolResults.length;
      this.pendingCallId = undefined;
    }

    // Re-prompt after a rejected final_answer: every tool_call needs a tool
    // response, so answer the pending final_answer call with the violations and
    // let the model correct it (spec 03 §1 re-prompt-once).
    if (this.pendingFinalCallId) {
      const feedback = history.validationFeedback?.join('; ') ?? 'The previous answer was invalid.';
      this.messages.push({
        role: 'tool',
        tool_call_id: this.pendingFinalCallId,
        content: `Your final_answer was rejected: ${feedback}. Fix it and call final_answer again, citing only evidence ids returned by run_sql.`,
      });
      this.pendingFinalCallId = undefined;
    }

    const assistant = await this.complete(
      {
        model: this.model,
        messages: this.messages,
        tools: AGENT_TOOLS,
        tool_choice: 'required',
        temperature: 0,
        max_tokens: this.maxTokens,
      },
      { ...(signal ? { signal } : {}) },
    );
    this.messages.push({
      role: 'assistant',
      content: assistant.content ?? null,
      ...(assistant.tool_calls ? { tool_calls: assistant.tool_calls } : {}),
    });

    // With tool_choice:'required' the model should always call a tool; if a
    // provider ignores that (returns prose, or a malformed/empty body), we end
    // this turn as an honest non-answer rather than guessing.
    const call = assistant.tool_calls?.[0];
    if (!call) return unblock('insufficient_results', 'The assistant did not take an action.');
    const args = asRecord(safeParse(call.function.arguments));

    switch (call.function.name) {
      case 'run_sql':
        this.pendingCallId = call.id;
        return {
          kind: 'query',
          proposal: { purpose: asString(args.purpose), sql: asString(args.sql) },
        };
      case 'cannot_answer':
        return { kind: 'unblock', missing: toMissing(args.missing) };
      case 'final_answer':
        this.pendingFinalCallId = call.id; // so a re-prompt can respond to this call
        return { kind: 'final', draft: toDraft(args) };
      default:
        return unblock('insufficient_results', `Unknown action: ${call.function.name}`);
    }
  }
}

/** Build provider config from env, or null if a real provider isn't configured. */
export function openAIConfigFromEnv(env: NodeJS.ProcessEnv): OpenAIProviderConfig | null {
  if (env.AGENT_PROVIDER !== 'openai') return null;
  const apiKey = env.OPENAI_API_KEY ?? env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const config: OpenAIProviderConfig = {
    apiKey,
    baseURL: env.OPENAI_BASE_URL ?? 'https://api.deepseek.com',
    model: env.AGENT_MODEL ?? 'deepseek-chat',
  };
  // Ignore a non-numeric AGENT_MAX_TOKENS rather than sending max_tokens: NaN/null.
  const maxTokens = Number(env.AGENT_MAX_TOKENS);
  if (Number.isFinite(maxTokens) && maxTokens > 0) config.maxTokens = maxTokens;
  return config;
}
