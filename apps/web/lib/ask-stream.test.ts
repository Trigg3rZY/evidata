import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import {
  createSampleConnector,
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_SCHEMA_SNAPSHOT,
  sampleSafetyContext,
  sampleVerifiedContext,
  type SampleConnectorHandle,
} from '@evidata/connector-sample';
import { createSafetyGate } from '@evidata/safety';
import { createRedactor } from '@evidata/redaction';
import { fixtureFor } from '@evidata/agent';
import { InvestigationService } from '@evidata/investigation';
import { askStream, parseAskBody, pickScenario, sseEvent } from './ask-stream';

describe('ask-stream helpers', () => {
  it('encodes an SSE frame', () => {
    expect(sseEvent('reasoning', { label: 'x' })).toBe('event: reasoning\ndata: {"label":"x"}\n\n');
  });

  it('maps questions to canned scenarios', () => {
    expect(pickScenario('Why is ACME up this month?')).toBe('acme-bill-up');
    expect(pickScenario('Please update that spend row')).toBe('mutation-attempt');
    expect(pickScenario("usage and billing don't reconcile")).toBe('cross-area-reconcile');
    expect(pickScenario('How is spend trending?')).toBe('needs-timerange');
  });

  it('validates and normalizes the body', () => {
    expect(parseAskBody(null)).toEqual({ error: expect.any(String) });
    expect(parseAskBody({ question: '   ' })).toEqual({ error: expect.any(String) });
    expect(parseAskBody({ question: 'hi' })).toEqual({
      dataSourceId: 'sample',
      question: 'hi',
      language: 'en',
    });
    expect(parseAskBody({ question: 'hi', language: 'zh-CN' })).toMatchObject({
      language: 'zh-CN',
    });
  });
});

describe('askStream (integration over the real Sample)', () => {
  let db: MetadataDbHandle;
  let sample: SampleConnectorHandle;
  let service: InvestigationService;

  beforeAll(async () => {
    db = await createMetadataDb();
    sample = await createSampleConnector();
    service = new InvestigationService({
      dataSources: [
        {
          id: SAMPLE_DATA_SOURCE_ID,
          name: 'Sample — Advertising Platform',
          connector: sample.connector,
          safetyContext: sampleSafetyContext(),
          schema: SAMPLE_SCHEMA_SNAPSHOT,
          context: sampleVerifiedContext(),
        },
      ],
      gate: createSafetyGate(),
      redactor: createRedactor(),
      store: new DrizzleMetadataStore(db.db),
    });
  });

  afterAll(async () => {
    await db.close();
    await sample.close();
  });

  const collect = async (question: string, dataSourceId = 'sample'): Promise<string> => {
    const chunks: string[] = [];
    await askStream(
      { service, providerFor: (q) => fixtureFor(pickScenario(q)) },
      { dataSourceId, question, language: 'en' },
      (c) => chunks.push(c),
    );
    return chunks.join('');
  };

  it('streams reasoning → query → answer → done for acme-bill-up', async () => {
    const text = await collect("Why is ACME's ad bill higher this month than last?");
    expect(text).toContain('event: reasoning');
    expect(text).toContain('event: query');
    expect(text).toContain('event: answer');
    expect(text.trimEnd().endsWith('event: done\ndata: {}')).toBe(true);

    const answerFrame = text.split('\n\n').find((f) => f.startsWith('event: answer'));
    const answer = JSON.parse(answerFrame!.slice(answerFrame!.indexOf('data: ') + 6));
    expect(answer.status).toBe('Answered');
    expect(answer.evidence).toHaveLength(3);
  });

  it('emits a product-level error frame instead of throwing on an unknown data source', async () => {
    const text = await collect('anything', 'does-not-exist');
    expect(text).toContain('event: error');
    expect(text).not.toContain('Unknown data source'); // no raw internals leaked
  });
});
