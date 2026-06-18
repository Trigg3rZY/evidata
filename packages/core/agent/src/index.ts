// @evidata/agent — AgentRunner state machine + FixtureProvider (spec 03).
export { AgentRunner, type AgentRunnerDeps } from './runner';
export { FixtureProvider } from './fixture-provider';
export {
  fixtureFor,
  SAMPLE_SCENARIOS,
  ACME_BILL_UP,
  MUTATION_ATTEMPT,
  CROSS_AREA_RECONCILE,
  NEEDS_TIMERANGE,
} from './scenarios';
export { resolveUnblock, gateRejectToMissing, type UnblockResolution } from './unblock';
export { RunAbortedError } from './types';
// Evaluation harness (spec 13 §6) — labeled cases + scoring (the live pass wires the real model).
export { EVAL_CASES, type EvalCase, type EvalRoute } from './eval/cases';
export {
  runResultToTrace,
  scoreCase,
  scoreReport,
  formatReport,
  type TurnTrace,
  type CaseResult,
  type EvalReport,
  type UsageLike,
} from './eval/harness';
export type {
  AgentContext,
  AgentDecision,
  AgentHistory,
  AgentInput,
  AgentMessage,
  AgentProvider,
  ConversationTurn,
  AgentRunEvent,
  AnswerDraft,
  QueryProposal,
  QueryRunRecord,
  RunOptions,
  RunResult,
  ToolResult,
} from './types';
