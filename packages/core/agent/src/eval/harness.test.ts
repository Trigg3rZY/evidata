import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSampleConnector,
  sampleSafetyContext,
  SAMPLE_CONTEXT,
  SAMPLE_SCHEMA_SNAPSHOT,
  type SampleConnectorHandle,
} from '@evidata/connector-sample';
import { createSafetyGate } from '@evidata/safety';
import { createRedactor } from '@evidata/redaction';
import { AgentRunner, type AgentRunnerDeps } from '../runner';
import { fixtureFor } from '../scenarios';
import type { AgentContext, AgentInput, AgentProvider, QueryRunRecord } from '../types';
import { EVAL_CASES } from './cases';
import {
  formatReport,
  runResultToTrace,
  scoreCase,
  scoreReport,
  type CaseResult,
  type TurnTrace,
} from './harness';

// --- pure scoring (no model) -------------------------------------------------

const trace = (t: Partial<TurnTrace>): TurnTrace => ({
  route: 'answer',
  status: 'Answered',
  queries: 1,
  modelCalls: 1,
  tokens: 100,
  ...t,
});

describe('eval scoring (pure)', () => {
  it('scoreCase flags a route / status / maxQueries mismatch', () => {
    const greeting = EVAL_CASES.find((c) => c.id === 'greeting-zh')!;
    expect(scoreCase(greeting, trace({ route: 'reply', queries: 0 })).pass).toBe(true);
    const miss = scoreCase(greeting, trace({ route: 'answer', queries: 3 }));
    expect(miss.pass).toBe(false);
    expect(miss.reasons.join(' ')).toMatch(/route answer != expected reply/);
    expect(miss.reasons.join(' ')).toMatch(/queries 3 > max 0/);
  });

  it('scoreReport aggregates routing accuracy, answered-rate, and averages', () => {
    const results: CaseResult[] = [
      scoreCase(
        EVAL_CASES.find((c) => c.id === 'greeting-zh')!,
        trace({ route: 'reply', queries: 0, tokens: 0 }),
      ),
      scoreCase(
        EVAL_CASES.find((c) => c.id === 'data-why-zh')!,
        trace({ route: 'answer', status: 'Answered', queries: 4, tokens: 300 }),
      ),
      // an answer case that came back NoReliableAnswer → routing ok, not answered
      scoreCase(
        EVAL_CASES.find((c) => c.id === 'data-top-en')!,
        trace({ route: 'answer', status: 'NoReliableAnswer', queries: 2, tokens: 200 }),
      ),
    ];
    const report = scoreReport(results);
    expect(report.total).toBe(3);
    expect(report.routingAccuracy).toBe(1); // all routes matched expected
    expect(report.answeredRate).toBe(0.5); // 1 of 2 answer-cases Answered
    expect(report.avgQueries).toBeCloseTo((0 + 4 + 2) / 3);
    expect(report.avgTokens).toBeCloseTo((0 + 300 + 200) / 3);
    expect(formatReport(report)).toContain('routing 100%');
  });

  it('counts queries on a Message that ran queries first (no hidden execution)', () => {
    const qr: QueryRunRecord = {
      id: 'qr1',
      connectorId: 'c',
      sql: 'select 1',
      status: 'ok',
      rowCount: 1,
      truncated: false,
      elapsedMs: 1,
      evidenceRef: 'E1',
    };
    const t = runResultToTrace(
      { kind: 'message', message: { text: 'hi' }, queryRuns: [qr] },
      { calls: 2, totalTokens: 50 },
    );
    expect(t).toMatchObject({ route: 'reply', status: 'message', queries: 1 });
    // a zero-query case must then FAIL — the guardrail catches the execution.
    const offtopic = EVAL_CASES.find((c) => c.id === 'offtopic-zh')!;
    expect(scoreCase(offtopic, t).pass).toBe(false);
  });
});

// --- traces from real runs (deterministic: greeting guard + fixtures) --------

describe('eval traces (deterministic runs)', () => {
  let handle: SampleConnectorHandle;
  beforeAll(async () => {
    handle = await createSampleConnector();
  });
  afterAll(async () => {
    await handle.close();
  });

  const ctx = (): AgentContext => ({
    overview: SAMPLE_CONTEXT.overview,
    glossary: SAMPLE_CONTEXT.glossary
      .filter((g) => g.status === 'verified')
      .map((g) => ({ term: g.term, definition: g.definition })),
    mappings: SAMPLE_CONTEXT.mappings
      .filter((m) => m.status === 'verified')
      .map((m) => ({ from: m.from, to: m.to })),
  });
  const input = (question: string): AgentInput => ({
    investigationId: 'inv_eval',
    question,
    language: 'en',
    schema: SAMPLE_SCHEMA_SNAPSHOT,
    context: ctx(),
  });
  const deps = (provider: AgentProvider): AgentRunnerDeps => ({
    provider,
    connector: handle.connector,
    gate: createSafetyGate(),
    redactor: createRedactor(),
    safetyContext: sampleSafetyContext(),
    dataSourceName: 'Sample',
    now: () => new Date('2026-06-17T12:00:00Z'),
  });
  // never reached for a greeting (the guard short-circuits); used by fixture runs.
  const noop: AgentProvider = { next: () => Promise.resolve({ kind: 'reasoning', label: 'x' }) };

  it('greeting → reply route, 0 queries (matches the greeting case)', async () => {
    const result = await new AgentRunner(deps(noop)).run(input('你好'));
    const t = runResultToTrace(result, { calls: 0, totalTokens: 0 });
    expect(t).toMatchObject({ route: 'reply', status: 'message', queries: 0 });
    expect(scoreCase(EVAL_CASES.find((c) => c.id === 'greeting-zh')!, t).pass).toBe(true);
  });

  it('acme fixture → answer route, Answered, 3 queries', async () => {
    const result = await new AgentRunner(deps(fixtureFor('acme-bill-up'))).run(input('why up?'));
    const t = runResultToTrace(result, { calls: 4, totalTokens: 1200 });
    expect(t).toMatchObject({ route: 'answer', status: 'Answered', queries: 3, modelCalls: 4 });
  });

  it('mutation fixture → answer route, BlockedByPolicy, 0 queries', async () => {
    const result = await new AgentRunner(deps(fixtureFor('mutation-attempt'))).run(
      input('void it'),
    );
    const t = runResultToTrace(result);
    expect(t).toMatchObject({ route: 'answer', status: 'BlockedByPolicy', queries: 0 });
  });
});
