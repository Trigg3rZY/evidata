import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import {
  createSampleConnector,
  sampleSafetyContext,
  SAMPLE_CONTEXT,
  SAMPLE_SCHEMA_SNAPSHOT,
  type SampleConnectorHandle,
} from '@evidata/connector-sample';
import { createSafetyGate } from '@evidata/safety';
import { createRedactor } from '@evidata/redaction';
import {
  fixtureFor,
  FixtureProvider,
  type AgentDecision,
  type AgentInput,
  type AgentProvider,
} from '@evidata/agent';
import { InvestigationService, type DataSourceRuntime } from './service';

let db: MetadataDbHandle;
let sample: SampleConnectorHandle;
let service: InvestigationService;

beforeAll(async () => {
  db = await createMetadataDb();
  sample = await createSampleConnector();
  const rt: DataSourceRuntime = {
    id: 'sample',
    name: 'Sample — Advertising Platform',
    connector: sample.connector,
    safetyContext: sampleSafetyContext(),
    schema: SAMPLE_SCHEMA_SNAPSHOT,
    context: {
      overview: SAMPLE_CONTEXT.overview,
      glossary: SAMPLE_CONTEXT.glossary
        .filter((g) => g.status === 'verified')
        .map((g) => ({ term: g.term, definition: g.definition })),
      mappings: SAMPLE_CONTEXT.mappings
        .filter((m) => m.status === 'verified')
        .map((m) => ({ from: m.from, to: m.to })),
    },
  };
  service = new InvestigationService({
    dataSources: [rt],
    gate: createSafetyGate(),
    redactor: createRedactor(),
    store: new DrizzleMetadataStore(db.db),
  });
});

afterAll(async () => {
  await db.close();
  await sample.close();
});

describe('InvestigationService', () => {
  it('runs acme-bill-up end to end, streams events, and persists the answer', async () => {
    const events: string[] = [];
    const result = await service.ask(
      {
        dataSourceId: 'sample',
        question: "Why is ACME's ad bill higher this month?",
        language: 'en',
      },
      { provider: fixtureFor('acme-bill-up'), sink: (e) => events.push(e.type) },
    );
    if (result.kind !== 'answer') throw new Error('expected an answer result');
    const { investigationId, answer } = result;

    expect(answer.status).toBe('Answered');
    expect(answer.evidence).toHaveLength(3);
    expect(events).toContain('reasoning');
    expect(events).toContain('query');

    const thread = await service.getThread(investigationId);
    expect(thread?.answers).toHaveLength(1);
    expect(thread?.answers[0]?.status).toBe('Answered');
    expect(thread?.dataSourceId).toBe('sample');

    const list = await service.list();
    expect(list.some((i) => i.id === investigationId && i.latestStatus === 'Answered')).toBe(true);
  });

  it('blocks a mutation attempt and persists it as BlockedByPolicy with no query runs', async () => {
    const result = await service.ask(
      { dataSourceId: 'sample', question: 'Void the duplicate spend row', language: 'en' },
      { provider: fixtureFor('mutation-attempt') },
    );
    if (result.kind !== 'answer') throw new Error('expected an answer result');
    const { investigationId, answer } = result;
    expect(answer.status).toBe('BlockedByPolicy');

    const thread = await service.getThread(investigationId);
    expect(thread?.answers[0]?.status).toBe('BlockedByPolicy');
  });

  it('rejects an unknown data source', async () => {
    await expect(
      service.ask(
        { dataSourceId: 'nope', question: 'x', language: 'en' },
        { provider: fixtureFor('acme-bill-up') },
      ),
    ).rejects.toThrow(/Unknown data source/);
  });

  it('appends a follow-up as version 2 of the same Investigation', async () => {
    const first = await service.ask(
      {
        dataSourceId: 'sample',
        question: "Why is ACME's ad bill higher this month?",
        language: 'en',
      },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (first.kind !== 'answer') throw new Error('expected an answer');
    expect(first.answer.meta.version).toBe(1);

    const followup = await service.ask(
      {
        dataSourceId: 'sample',
        question: 'And which campaign drove it?',
        language: 'en',
        investigationId: first.investigationId,
      },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (followup.kind !== 'answer') throw new Error('expected an answer');
    expect(followup.investigationId).toBe(first.investigationId); // same thread
    expect(followup.answer.meta.version).toBe(2); // appended version
    expect(followup.answer.meta.isLatest).toBe(true);
    // audit provenance preserved (not stamped like a first answer)
    expect(followup.answer.meta.createdAfter).toEqual({ kind: 'followup', fromVersion: 1 });

    const thread = await service.getThread(first.investigationId);
    expect(thread?.answers).toHaveLength(2);
    expect(thread?.answers.filter((a) => a.meta.isLatest)).toHaveLength(1); // single head
    expect(thread?.turns.filter((t) => t.role === 'user')).toHaveLength(2);
  });

  it('seeds a follow-up with the prior turns as model context', async () => {
    const first = await service.ask(
      {
        dataSourceId: 'sample',
        question: "Why is ACME's ad bill higher this month?",
        language: 'en',
      },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (first.kind !== 'answer') throw new Error('expected an answer');

    let seen: AgentInput | undefined;
    const capturing: AgentProvider = {
      next: (input) => {
        seen = input;
        return Promise.resolve({ kind: 'message', text: 'noted' });
      },
    };
    await service.ask(
      {
        dataSourceId: 'sample',
        question: 'and by campaign?',
        language: 'en',
        investigationId: first.investigationId,
      },
      { provider: capturing },
    );

    expect(seen?.history).toHaveLength(1);
    expect(seen?.history?.[0]?.question).toBe("Why is ACME's ad bill higher this month?");
    expect(seen?.history?.[0]?.answer).toBe(first.answer.directAnswer);
  });

  it('binds a follow-up to the stored data source, ignoring the client dataSourceId', async () => {
    const first = await service.ask(
      {
        dataSourceId: 'sample',
        question: "Why is ACME's ad bill higher this month?",
        language: 'en',
      },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (first.kind !== 'answer') throw new Error('expected an answer');

    // A follow-up sends a bogus dataSourceId — it must NOT throw "Unknown data
    // source"; the investigation's bound source ('sample') is used regardless.
    const followup = await service.ask(
      {
        dataSourceId: 'does-not-exist',
        question: 'and by campaign?',
        language: 'en',
        investigationId: first.investigationId,
      },
      { provider: fixtureFor('acme-bill-up') },
    );
    expect(followup.kind).toBe('answer');
    if (followup.kind === 'answer') expect(followup.investigationId).toBe(first.investigationId);
  });

  it('a rerun appends a version with NO new user turn and versionTrigger rerun', async () => {
    const q = "Why is ACME's ad bill higher this month?";
    const first = await service.ask(
      { dataSourceId: 'sample', question: q, language: 'en' },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (first.kind !== 'answer') throw new Error('expected an answer');

    const rerun = await service.ask(
      {
        dataSourceId: 'sample',
        question: q,
        language: 'en',
        investigationId: first.investigationId,
        rerun: true,
      },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (rerun.kind !== 'answer') throw new Error('expected an answer');
    expect(rerun.investigationId).toBe(first.investigationId);
    expect(rerun.answer.meta.version).toBe(2);
    expect(rerun.answer.meta.isLatest).toBe(true);
    expect(rerun.answer.meta.createdAfter).toEqual({ kind: 'rerun', fromVersion: 1 });

    const thread = await service.getThread(first.investigationId);
    expect(thread?.answers).toHaveLength(2);
    expect(thread?.answers.filter((a) => a.meta.isLatest)).toHaveLength(1); // single head
    expect(thread?.turns.filter((t) => t.role === 'user')).toHaveLength(1); // no new user turn
  });

  it('reruns the LATEST stored question, not a stale client-sent one', async () => {
    const q = "Why is ACME's ad bill higher this month?";
    const first = await service.ask(
      { dataSourceId: 'sample', question: q, language: 'en' },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (first.kind !== 'answer') throw new Error('expected an answer');

    let seen: AgentInput | undefined;
    const capturing: AgentProvider = {
      next: (input) => {
        seen = input;
        return Promise.resolve({ kind: 'message', text: 'ok' });
      },
    };
    await service.ask(
      {
        dataSourceId: 'sample',
        question: 'a STALE different question',
        language: 'en',
        investigationId: first.investigationId,
        rerun: true,
      },
      { provider: capturing },
    );
    expect(seen?.question).toBe(q); // ran the latest stored question, not the client's
  });

  it('a later follow-up sees the regenerated (rerun) answer, not the stale one', async () => {
    const q = "Why is ACME's ad bill higher this month?";
    const first = await service.ask(
      { dataSourceId: 'sample', question: q, language: 'en' },
      { provider: fixtureFor('acme-bill-up') },
    );
    if (first.kind !== 'answer') throw new Error('expected an answer');

    // Rerun with a distinct answer so we can tell it apart from v1.
    const regen: AgentDecision[] = [
      {
        kind: 'query',
        proposal: {
          purpose: 'p',
          sql: "select sum(amount) as total from campaign_spend where account_id = 1 and status = 'posted'",
        },
      },
      {
        kind: 'final',
        draft: {
          status: 'Answered',
          confidence: 'High',
          directAnswer: 'REGENERATED',
          confidenceReason: 'r',
          keyFindings: [{ text: 'f', evidenceIds: ['E1'] }],
        },
      },
    ];
    const rerun = await service.ask(
      {
        dataSourceId: 'sample',
        question: q,
        language: 'en',
        investigationId: first.investigationId,
        rerun: true,
      },
      { provider: new FixtureProvider(regen) },
    );
    if (rerun.kind !== 'answer') throw new Error('expected an answer');
    expect(rerun.answer.directAnswer).toBe('REGENERATED');

    let seen: AgentInput | undefined;
    const capturing: AgentProvider = {
      next: (input) => {
        seen = input;
        return Promise.resolve({ kind: 'message', text: 'ok' });
      },
    };
    await service.ask(
      {
        dataSourceId: 'sample',
        question: 'next?',
        language: 'en',
        investigationId: first.investigationId,
      },
      { provider: capturing },
    );
    // context for the latest turn reflects the rerun, not the original answer
    expect(seen?.history?.at(-1)?.answer).toBe('REGENERATED');
  });

  it('rejects a follow-up to an unknown investigation', async () => {
    await expect(
      service.ask(
        { dataSourceId: 'sample', question: 'x', language: 'en', investigationId: 'inv_nope' },
        { provider: fixtureFor('acme-bill-up') },
      ),
    ).rejects.toThrow(/Unknown investigation/);
  });
});
