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

const STRUCTURAL: ReadonlySet<string> = new Set([':', ',', '}', ']']);

/**
 * Repair the two malformations DeepSeek emits in tool-call arguments — both invalid
 * JSON the strict parser rejects, losing an otherwise-good answer:
 *   1. Unescaped ASCII double-quotes inside string values (e.g. `新增了 "Summer Sale" 活动`).
 *   2. Raw control characters (literal newlines/tabs) inside string values.
 *
 * We walk the text tracking string state. A `"` inside a string is treated as the
 * closing quote only when the next non-space char is structural (`:,}]`) or the
 * input ends; otherwise it's content and gets escaped. Control chars inside strings
 * are escaped too. This is a best-effort repair tried only after strict parse fails.
 */
function lenientJson(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j] as string)) j++;
      const next = s[j];
      if (next === undefined || STRUCTURAL.has(next)) {
        inStr = false;
        out += ch;
      } else {
        out += '\\"'; // content quote → escape
      }
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += code === 0x0a ? '\\n' : code === 0x09 ? '\\t' : code === 0x0d ? '\\r' : '';
      continue;
    }
    out += ch;
  }
  return out;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    try {
      return JSON.parse(lenientJson(json)) as unknown;
    } catch {
      return {};
    }
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
    status: 'Answered', // the final_answer tool only offers 'Answered' (see AnswerDraft)
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

/** Transient HTTP statuses worth retrying (rate limit + upstream/gateway hiccups). */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Default transport: a plain typed POST to an OpenAI-compatible `/chat/completions`,
 * with a bounded retry-with-backoff for transient failures (network errors and
 * 429/5xx). A single hiccup otherwise aborts the whole turn — DeepSeek occasionally
 * 503s mid-investigation. Aborts (client disconnect) are never retried; 4xx other
 * than the rate-limit family fail fast.
 */
export function fetchComplete(cfg: OpenAIProviderConfig, maxRetries = 2): Complete {
  const base = cfg.baseURL.replace(/\/+$/, '');
  const backoffMs = cfg.retryBackoffMs ?? 300;
  return async (req: CompletionRequest, opts) => {
    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw new Error('AI provider request aborted');
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(req),
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
      } catch (err) {
        // Network/transport error: retry unless aborted or out of attempts.
        if (opts.signal?.aborted || attempt >= maxRetries) throw err;
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
        continue;
      }
      if (res.ok) {
        const data = (await res.json()) as ChatResponse;
        const msg = data.choices?.[0]?.message;
        return {
          content: msg?.content ?? null,
          ...(msg?.tool_calls ? { tool_calls: msg.tool_calls } : {}),
        };
      }
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= maxRetries) {
        throw new Error(`AI provider returned HTTP ${res.status}`);
      }
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
    }
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
    // A detailed, evidence-backed final_answer (esp. in CJK, where one char ≈ 1+
    // token) can exceed 1k tokens. If the tool-call arguments are truncated, the
    // JSON won't parse and the answer is lost — so default generously. Note:
    // DeepSeek reports finish_reason='tool_calls' even on a length cutoff, so we
    // can't detect truncation reliably; the only safe lever is a roomy budget.
    this.maxTokens = cfg.maxTokens ?? 4096;
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

    // Last step: force final_answer with the evidence gathered, rather than let
    // the model keep exploring and exhaust the budget with no answer.
    if (history.mustFinalize) {
      this.messages.push({
        role: 'user',
        content:
          'This is your last step — do not run more queries. Call final_answer now using the evidence already gathered (cite the E# ids). If the evidence is thin, still answer, but use a lower confidence (Low) and note the limitation in a caveat.',
      });
    }

    const assistant = await this.complete(
      {
        model: this.model,
        messages: this.messages,
        tools: AGENT_TOOLS,
        tool_choice: history.mustFinalize
          ? { type: 'function', function: { name: 'final_answer' } }
          : 'required',
        temperature: 0,
        max_tokens: this.maxTokens,
      },
      { ...(signal ? { signal } : {}) },
    );
    // We act on exactly one tool call per turn. DeepSeek occasionally returns
    // several in one assistant message; recording the extras would leave them
    // unanswered, and the NEXT request then violates the "every tool_call needs a
    // tool response" rule and is rejected with HTTP 400. So keep only the call we
    // process, so the transcript stays one tool_call ↔ one tool response.
    const call = assistant.tool_calls?.[0];
    this.messages.push({
      role: 'assistant',
      content: assistant.content ?? null,
      ...(call ? { tool_calls: [call] } : {}),
    });

    // With tool_choice:'required' the model should always call a tool; if a
    // provider ignores that (returns prose, or a malformed/empty body), we end
    // this turn as an honest non-answer rather than guessing.
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
