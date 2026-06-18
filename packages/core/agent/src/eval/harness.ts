/**
 * Agent evaluation harness (spec 13 §6): turn a finished turn into a TurnTrace,
 * score it against a labeled case's expectations, and aggregate a report
 * (routing accuracy, answered-rate, avg queries/tokens).
 *
 * Pure and provider-agnostic — the CALLER runs the cases (fixtures in CI, the real
 * model in the env-gated live pass) and feeds results in. So this stays free of
 * provider/connector/investigation deps (no import cycles). `usage` is a minimal
 * structural type, not the provider's ProviderUsage, for the same reason.
 */
import type { RunResult } from '../types';
import type { EvalCase, EvalRoute } from './cases';

export interface UsageLike {
  calls: number;
  totalTokens: number;
}

export interface TurnTrace {
  route: EvalRoute;
  /** The Answer status, or 'message' for a conversational reply/draft. */
  status: string;
  /** Executed (ok) queries this turn. */
  queries: number;
  modelCalls: number;
  tokens: number;
}

/** Build a trace from the agent's RunResult (the deterministic / fixture path). */
export function runResultToTrace(result: RunResult, usage?: UsageLike): TurnTrace {
  const modelCalls = usage?.calls ?? 0;
  const tokens = usage?.totalTokens ?? 0;
  if (result.kind === 'message') {
    return {
      route: result.message.sql ? 'draft_sql' : 'reply',
      status: 'message',
      queries: 0,
      modelCalls,
      tokens,
    };
  }
  return {
    route: 'answer',
    status: result.answer.status,
    queries: result.queryRuns.filter((q) => q.status === 'ok').length,
    modelCalls,
    tokens,
  };
}

export interface CaseResult {
  id: string;
  intent: string;
  expectedRoute: EvalRoute[];
  /** The route matched one of the acceptable routes (the routing-accuracy signal). */
  routeOk: boolean;
  trace: TurnTrace;
  pass: boolean;
  reasons: string[];
}

export function scoreCase(c: EvalCase, trace: TurnTrace): CaseResult {
  const accepted = Array.isArray(c.expect.route) ? c.expect.route : [c.expect.route];
  const reasons: string[] = [];
  const routeOk = accepted.includes(trace.route);
  if (!routeOk) reasons.push(`route ${trace.route} != expected ${accepted.join('|')}`);
  if (c.expect.status !== undefined && trace.status !== c.expect.status) {
    reasons.push(`status ${trace.status} != expected ${c.expect.status}`);
  }
  if (c.expect.maxQueries !== undefined && trace.queries > c.expect.maxQueries) {
    reasons.push(`queries ${trace.queries} > max ${c.expect.maxQueries}`);
  }
  return {
    id: c.id,
    intent: c.intent,
    expectedRoute: accepted,
    routeOk,
    trace,
    pass: reasons.length === 0,
    reasons,
  };
}

export interface EvalReport {
  total: number;
  passed: number;
  /** Fraction whose route matched the expected route. */
  routingAccuracy: number;
  /** Of the cases expecting an `answer`, the fraction that came back Answered. */
  answeredRate: number;
  avgQueries: number;
  avgTokens: number;
  results: CaseResult[];
}

export function scoreReport(results: CaseResult[]): EvalReport {
  const total = results.length;
  const routeHits = results.filter((r) => r.routeOk).length;
  // answer-only cases (those whose sole acceptable route is 'answer') gauge answered-rate.
  const answerCases = results.filter(
    (r) => r.expectedRoute.length === 1 && r.expectedRoute[0] === 'answer',
  );
  const answered = answerCases.filter((r) => r.trace.status === 'Answered').length;
  const sum = (f: (r: CaseResult) => number): number => results.reduce((a, r) => a + f(r), 0);
  return {
    total,
    passed: results.filter((r) => r.pass).length,
    routingAccuracy: total ? routeHits / total : 0,
    answeredRate: answerCases.length ? answered / answerCases.length : 0,
    avgQueries: total ? sum((r) => r.trace.queries) / total : 0,
    avgTokens: total ? sum((r) => r.trace.tokens) / total : 0,
    results,
  };
}

/** A compact, log-friendly summary of a report. */
export function formatReport(report: EvalReport): string {
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  const lines = report.results.map(
    (r) =>
      `  ${r.pass ? '✓' : '✗'} ${r.id} [${r.intent}] → ${r.trace.route}/${r.trace.status} ` +
      `q=${r.trace.queries} tok=${r.trace.tokens}` +
      (r.pass ? '' : ` — ${r.reasons.join('; ')}`),
  );
  return [
    `Eval: ${report.passed}/${report.total} passed · routing ${pct(report.routingAccuracy)} · ` +
      `answered ${pct(report.answeredRate)} · avg queries ${report.avgQueries.toFixed(1)} · ` +
      `avg tokens ${Math.round(report.avgTokens)}`,
    ...lines,
  ].join('\n');
}
