import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateAnswer } from '@evidata/answer-contract';
import {
  createSampleConnector,
  sampleSafetyContext,
  SAMPLE_CONTEXT,
  SAMPLE_SCHEMA_SNAPSHOT,
  type SampleConnectorHandle,
} from '@evidata/connector-sample';
import { createSafetyGate } from '@evidata/safety';
import { createRedactor } from '@evidata/redaction';
import { AgentRunner, type AgentRunnerDeps } from './runner';
import { fixtureFor } from './scenarios';
import { FixtureProvider } from './fixture-provider';
import type {
  AgentContext,
  AgentDecision,
  AgentInput,
  AgentProvider,
  AgentRunEvent,
  RunResult,
} from './types';

let handle: SampleConnectorHandle;

beforeAll(async () => {
  handle = await createSampleConnector();
});
afterAll(async () => {
  await handle.close();
});

const verifiedContext = (): AgentContext => ({
  overview: SAMPLE_CONTEXT.overview,
  glossary: SAMPLE_CONTEXT.glossary
    .filter((g) => g.status === 'verified')
    .map((g) => ({ term: g.term, definition: g.definition })),
  // Only Verified mappings reach the provider — the Suggested customer_ref mapping is withheld.
  mappings: SAMPLE_CONTEXT.mappings
    .filter((m) => m.status === 'verified')
    .map((m) => ({ from: m.from, to: m.to })),
});

const input = (question: string): AgentInput => ({
  investigationId: 'inv_test',
  question,
  language: 'en',
  schema: SAMPLE_SCHEMA_SNAPSHOT,
  context: verifiedContext(),
});

const deps = (provider: AgentProvider, sink?: (e: AgentRunEvent) => void): AgentRunnerDeps => {
  let n = 0;
  return {
    provider,
    connector: handle.connector,
    gate: createSafetyGate(),
    redactor: createRedactor(),
    safetyContext: sampleSafetyContext(),
    dataSourceName: 'Sample — Advertising Platform',
    now: () => new Date('2026-06-17T12:00:00Z'),
    newId: (p: string) => `${p}_${(n += 1)}`,
    ...(sink ? { sink } : {}),
  };
};

const numbers = (rows: ReadonlyArray<Record<string, unknown>>, key: string): number[] =>
  rows.map((r) => Number(r[key]));

// These scenarios all produce an Answer (not a conversational Message); narrow the
// RunResult union so the assertions can read `.answer` / `.queryRuns`.
function asAnswer(r: RunResult): {
  answer: import('@evidata/answer-contract').Answer;
  queryRuns: import('./types').QueryRunRecord[];
} {
  if (r.kind !== 'answer') throw new Error(`expected an answer result, got ${r.kind}`);
  return { answer: r.answer, queryRuns: r.queryRuns };
}

describe('acme-bill-up — happy path (spec 05 §4.1)', () => {
  it('produces a valid Answered/Medium answer with three evidence items from real data', async () => {
    const events: AgentRunEvent[] = [];
    const { answer, queryRuns } = asAnswer(
      await new AgentRunner(deps(fixtureFor('acme-bill-up'), (e) => events.push(e))).run(
        input("Why is ACME's ad bill higher this month than last month?"),
      ),
    );

    expect(answer.status).toBe('Answered');
    expect(answer.confidence).toBe('Medium');
    expect(validateAnswer(answer)).toEqual([]);
    expect(answer.meta).toMatchObject({ version: 1, isLatest: true });

    // three queries executed and recorded (G4); each finding cites recorded evidence (G3)
    expect(queryRuns).toHaveLength(3);
    expect(queryRuns.every((q) => q.status === 'ok')).toBe(true);
    expect(answer.evidence.map((e) => e.id)).toEqual(['E1', 'E2', 'E3']);
    const evidenceIds = new Set(answer.evidence.map((e) => e.id));
    for (const f of answer.keyFindings) {
      expect(f.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }

    // the data is real: E1 carries the seeded May/June totals
    const e1Totals = numbers(answer.evidence[0]!.sampleRows ?? [], 'total');
    expect(e1Totals).toContain(34900);
    expect(e1Totals).toContain(48200);

    // events streamed for the UI: reasoning + query running/ok
    expect(events.filter((e) => e.type === 'reasoning')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'query' && e.status === 'ok')).toHaveLength(3);
  });
});

describe('mutation-attempt — guardrail (spec 05 §4.5)', () => {
  it('blocks the write before execution and records no query run', async () => {
    const { answer, queryRuns } = asAnswer(
      await new AgentRunner(deps(fixtureFor('mutation-attempt'))).run(
        input('Void the duplicate spend row for ACME'),
      ),
    );

    expect(answer.status).toBe('BlockedByPolicy');
    expect(queryRuns).toHaveLength(0); // nothing executed — the boundary held
    expect(validateAnswer(answer)).toEqual([]);
    expect(answer.unblock?.nextSteps.some((a) => a.kind === 'view_mutation_draft')).toBe(true);
  });
});

describe('cross-area-reconcile — Unblock Path (spec 05 §4.3)', () => {
  it('gathers each area but blocks on the unverified mapping', async () => {
    const { answer, queryRuns } = asAnswer(
      await new AgentRunner(deps(fixtureFor('cross-area-reconcile'))).run(
        input("Why don't usage and billing reconcile for ACME?"),
      ),
    );

    expect(answer.status).toBe('NoReliableAnswer');
    expect(answer.confidence).toBe('CannotDetermine');
    expect(queryRuns).toHaveLength(2);
    // the non-answer still shows the work it did before blocking
    expect(answer.evidence.map((e) => e.id)).toEqual(['E1', 'E2']);
    expect(answer.unblock?.whatsMissing[0]?.kind).toBe('unverified_mapping');
    const notify = answer.unblock?.nextSteps.find((a) => a.kind === 'notify_admin_verify');
    expect(notify?.createsSuggestion).toBe(true);
    expect(validateAnswer(answer)).toEqual([]);
  });
});

describe('needs-timerange — clarification (spec 05 §4.4)', () => {
  it('asks for a time range', async () => {
    const { answer } = asAnswer(
      await new AgentRunner(deps(fixtureFor('needs-timerange'))).run(
        input('How is spend trending?'),
      ),
    );
    expect(answer.status).toBe('NeedsClarification');
    expect(answer.unblock?.nextSteps.some((a) => a.kind === 'set_time_range')).toBe(true);
    expect(validateAnswer(answer)).toEqual([]);
  });
});

describe('localization', () => {
  it('produces non-answer text in the question language (zh-CN)', async () => {
    const { answer } = asAnswer(
      await new AgentRunner(deps(fixtureFor('needs-timerange'))).run({
        investigationId: 'inv_zh',
        question: '最近花费趋势如何?',
        language: 'zh-CN',
        schema: SAMPLE_SCHEMA_SNAPSHOT,
        context: verifiedContext(),
      }),
    );
    expect(answer.status).toBe('NeedsClarification');
    expect(answer.directAnswer).toBe('我需要更多信息才能可靠地回答。');
    expect(validateAnswer(answer)).toEqual([]);
  });
});

describe('step budget', () => {
  it('falls back to an honest non-answer when the provider never concludes', async () => {
    const looping: AgentProvider = {
      next: () => Promise.resolve({ kind: 'reasoning', label: 'thinking…' }),
    };
    const { answer, queryRuns } = asAnswer(
      await new AgentRunner({ ...deps(looping), maxIterations: 3 }).run(input('endless')),
    );

    expect(answer.status).toBe('NoReliableAnswer');
    expect(queryRuns).toHaveLength(0);
    expect(validateAnswer(answer)).toEqual([]);
  });
});

describe('FixtureProvider', () => {
  it('exits with an honest non-answer when the script is exhausted', async () => {
    const { answer } = asAnswer(
      await new AgentRunner(deps(new FixtureProvider([]))).run(input('nothing scripted')),
    );
    expect(answer.status).toBe('NoReliableAnswer');
  });
});

describe('re-prompt on invalid final (spec 03 §1)', () => {
  const goodSql =
    "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'";
  const draft = (evidenceIds: [string, ...string[]]): AgentDecision => ({
    kind: 'final',
    draft: {
      status: 'Answered',
      confidence: 'High',
      directAnswer: 'total',
      confidenceReason: 'one query',
      keyFindings: [{ text: 'computed', evidenceIds }],
    },
  });

  it('re-prompts once with the violations, then accepts a corrected answer', async () => {
    let step = 0;
    let sawFeedback: string[] | undefined;
    const provider: AgentProvider = {
      next: (_input, history) => {
        step += 1;
        if (step === 1)
          return Promise.resolve({ kind: 'query', proposal: { purpose: 'p', sql: goodSql } });
        if (step === 2) return Promise.resolve(draft(['E9'])); // dangling evidence → invalid
        sawFeedback = history.validationFeedback;
        return Promise.resolve(draft(['E1'])); // corrected
      },
    };
    const { answer } = asAnswer(await new AgentRunner(deps(provider)).run(input('total?')));
    expect(answer.status).toBe('Answered');
    expect(answer.keyFindings[0]?.evidenceIds).toEqual(['E1']);
    expect(sawFeedback?.length).toBeGreaterThan(0); // the provider received the violations
  });

  it('downgrades to NoReliableAnswer if the answer is still invalid after the retry', async () => {
    let step = 0;
    const provider: AgentProvider = {
      next: () => {
        step += 1;
        if (step === 1)
          return Promise.resolve({ kind: 'query', proposal: { purpose: 'p', sql: goodSql } });
        return Promise.resolve(draft(['E9'])); // always cites missing evidence
      },
    };
    const { answer } = asAnswer(await new AgentRunner(deps(provider)).run(input('total?')));
    expect(answer.status).toBe('NoReliableAnswer');
    expect(validateAnswer(answer)).toEqual([]);
  });
});

describe('force-finalize on the last budget step', () => {
  it('answers with gathered evidence instead of exhausting the budget', async () => {
    const goodSql =
      "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'";
    // A model that would keep exploring forever — but finalizes when told it's the last step.
    const provider: AgentProvider = {
      next: (_input, history) => {
        if (history.mustFinalize) {
          return Promise.resolve({
            kind: 'final',
            draft: {
              status: 'Answered',
              confidence: 'Low',
              directAnswer: 'best effort',
              confidenceReason: 'reached the step limit',
              keyFindings: [{ text: 'computed', evidenceIds: ['E1'] }],
            },
          });
        }
        return Promise.resolve({ kind: 'query', proposal: { purpose: 'explore', sql: goodSql } });
      },
    };
    const { answer } = asAnswer(
      await new AgentRunner({ ...deps(provider), maxIterations: 3 }).run(input('open-ended')),
    );
    expect(answer.status).toBe('Answered'); // an answer, not NoReliableAnswer
    expect(validateAnswer(answer)).toEqual([]);
  });

  it('fails closed when the forced final is invalid (no budget left to retry)', async () => {
    const goodSql =
      "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'";
    // The forced final cites evidence that was never gathered → invalid, and the
    // loop has no step left to re-prompt, so it downgrades to an honest non-answer.
    const provider: AgentProvider = {
      next: (_input, history) => {
        if (history.mustFinalize) {
          return Promise.resolve({
            kind: 'final',
            draft: {
              status: 'Answered',
              confidence: 'High',
              directAnswer: 'overconfident',
              confidenceReason: 'ignored the budget',
              keyFindings: [{ text: 'cites nothing real', evidenceIds: ['E9'] }],
            },
          });
        }
        return Promise.resolve({ kind: 'query', proposal: { purpose: 'explore', sql: goodSql } });
      },
    };
    const { answer } = asAnswer(
      await new AgentRunner({ ...deps(provider), maxIterations: 3 }).run(input('open-ended')),
    );
    expect(answer.status).toBe('NoReliableAnswer');
    expect(validateAnswer(answer)).toEqual([]);
  });
});

describe('intent: Answer vs Message (spec 13)', () => {
  it('replies to a greeting with a Message — zero provider calls and zero queries', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      next: () => {
        calls += 1;
        return Promise.resolve({ kind: 'reasoning', label: 'x' });
      },
    };
    const r = await new AgentRunner(deps(provider)).run(input('你好'));
    expect(r.kind).toBe('message');
    if (r.kind === 'message') expect(r.message.text.length).toBeGreaterThan(0);
    expect(calls).toBe(0); // the greeting guard short-circuits before any model call
  });

  it('returns a Message (drafted, unexecuted SQL) when the provider asks to draft', async () => {
    const provider: AgentProvider = {
      next: () =>
        Promise.resolve({
          kind: 'message',
          text: 'Here is the statement (not run):',
          sql: 'DELETE FROM campaign_spend WHERE amount > 30',
        }),
    };
    const r = await new AgentRunner(deps(provider)).run(input('write me a delete statement'));
    expect(r.kind).toBe('message');
    if (r.kind === 'message') {
      expect(r.message.sql).toContain('DELETE');
      expect(r.message.text).toContain('not run');
    }
  });
});

describe('cancellation (spec 13 §4)', () => {
  it('throws AbortError without calling the provider when already aborted', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      next: () => {
        calls += 1;
        return Promise.resolve({ kind: 'reasoning', label: 'x' });
      },
    };
    const controller = new AbortController();
    controller.abort();
    // name 'AbortError' is the contract askStream keys on to emit `aborted`, not `error`.
    await expect(
      new AgentRunner(deps(provider)).run(input('endless'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });

  it('stops between steps once aborted (no further provider calls)', async () => {
    const controller = new AbortController();
    let calls = 0;
    const provider: AgentProvider = {
      next: () => {
        calls += 1;
        controller.abort(); // abort while "thinking"
        return Promise.resolve({ kind: 'reasoning', label: 'thinking…' });
      },
    };
    await expect(
      new AgentRunner(deps(provider)).run(input('endless'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1); // first step ran; the loop-top check stops the second
  });
});

describe('executor error recovery', () => {
  it('records a failed query, feeds the error back, and still finishes', async () => {
    // The gate allows both (read-only, authorized table); the first SQL fails in
    // the engine (bad column), the provider then runs a valid query and answers.
    const script: AgentDecision[] = [
      { kind: 'query', proposal: { purpose: 'oops', sql: 'select bogus_col from accounts' } },
      {
        kind: 'query',
        proposal: {
          purpose: 'real',
          sql: "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'",
        },
      },
      {
        kind: 'final',
        draft: {
          status: 'Answered',
          confidence: 'High',
          directAnswer: 'ACME total posted spend',
          confidenceReason: 'single query',
          keyFindings: [{ text: 'total computed', evidenceIds: ['E1'] }],
        },
      },
    ];
    const events: AgentRunEvent[] = [];
    const { answer, queryRuns } = asAnswer(
      await new AgentRunner(deps(new FixtureProvider(script), (e) => events.push(e))).run(
        input('total spend?'),
      ),
    );

    expect(answer.status).toBe('Answered');
    expect(answer.evidence.map((e) => e.id)).toEqual(['E1']); // only the successful query is evidence
    expect(queryRuns.map((q) => q.status)).toEqual(['error', 'ok']); // both recorded (G4); failure first
    expect(events.some((e) => e.type === 'query' && e.status === 'error')).toBe(true);
    expect(validateAnswer(answer)).toEqual([]);
  });
});
