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
export type {
  AgentContext,
  AgentDecision,
  AgentHistory,
  AgentInput,
  AgentProvider,
  AgentRunEvent,
  AnswerDraft,
  QueryProposal,
  QueryRunRecord,
  RunOptions,
  RunResult,
  ToolResult,
} from './types';
