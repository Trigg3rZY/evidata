/**
 * Agent protocol (spec 03 §1, §7).
 *
 * SCRUTINY NOTE: the spec sketched the provider as a streaming generator whose
 * `propose_sql` steps the runner intercepts and feeds results back into. We use
 * the mainstream **decision / tool-use loop** instead: the provider is a pure
 * `next(input, history) → AgentDecision` step function, and the AgentRunner
 * remains the sole controller of the SafetyGate, execution, the reject→status
 * mapping (§5), the loop budget, and event emission. This keeps the trust
 * boundary identical while avoiding the bidirectional-generator typing pitfalls.
 */
import type {
  Answer,
  AssumptionItem,
  Chart,
  Confidence,
  FollowupSuggestion,
  KeyFinding,
  LocalizedText,
  MissingInfo,
} from '@evidata/answer-contract';
import type { ColumnMeta, QueryRunRecord, SchemaSnapshot } from '@evidata/ports';

/** Verified-only Data Source context handed to the provider (spec 09 §2.3). */
export interface AgentContext {
  overview: string;
  glossary: ReadonlyArray<{ term: string; definition: string }>;
  mappings: ReadonlyArray<{ from: string; to: string }>;
}

export interface AgentInput {
  investigationId: string;
  question: string;
  language: 'en' | 'zh-CN';
  schema: SchemaSnapshot;
  context: AgentContext;
}

/** A bounded, redacted result handed back to the provider after a query runs. */
export interface ToolResult {
  evidenceRef: string; // 'E1' on success; a non-evidence marker on a failed query
  purpose: string;
  columns: ColumnMeta[];
  sampleRows: ReadonlyArray<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  redactedColumns: string[];
  /** Set when the query failed to execute — fed back so the provider can correct its SQL. */
  error?: string;
}

/** Everything the provider has seen so far this turn (drives the next decision). */
export interface AgentHistory {
  toolResults: ToolResult[];
  reasoning: string[];
  /** Set by the runner when a `final` draft failed contract validation, so the
   *  provider can correct it once before the runner downgrades (spec 03 §1). */
  validationFeedback?: string[];
  /** Set by the runner on the last budget step: the provider should answer NOW
   *  (final_answer) with the evidence gathered rather than keep exploring. */
  mustFinalize?: boolean;
}

export interface QueryProposal {
  purpose: string;
  sql: string;
}

/** A final, answered draft. The runner attaches evidence, version meta, and validates. */
export interface AnswerDraft {
  status: 'Answered' | 'Partial';
  directAnswer: LocalizedText;
  confidence: Confidence;
  confidenceReason: LocalizedText;
  whatIDid?: LocalizedText;
  keyFindings: KeyFinding[];
  assumptions?: AssumptionItem[];
  caveats?: LocalizedText[];
  charts?: Chart[];
  recommendedFollowups?: FollowupSuggestion[];
}

export type AgentDecision =
  | { kind: 'reasoning'; label: string }
  | { kind: 'query'; proposal: QueryProposal }
  | { kind: 'unblock'; missing: [MissingInfo, ...MissingInfo[]] }
  | { kind: 'final'; draft: AnswerDraft };

export interface AgentProvider {
  next(input: AgentInput, history: AgentHistory): Promise<AgentDecision>;
}

/** Domain events emitted during a run (phase 6 adapts these to SSE; spec 03 §6). */
export type AgentRunEvent =
  | { type: 'reasoning'; label: string }
  | { type: 'query'; purpose: string; status: 'running' }
  | { type: 'query'; purpose: string; status: 'ok'; rowCount: number; elapsedMs: number }
  | { type: 'query'; purpose: string; status: 'error'; message: string };

/** Audit record of one executed query (G4); canonical shape lives in ports. */
export type { QueryRunRecord };

export interface RunResult {
  answer: Answer;
  /** Every executed query, in order (basis of the G4 count). */
  queryRuns: QueryRunRecord[];
}
