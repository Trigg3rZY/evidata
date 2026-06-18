/**
 * Live agent-eval pass (spec 13 §6). Runs the labeled EVAL_CASES against the REAL
 * model and prints routing accuracy / answered-rate / avg queries / tokens.
 *
 * Env-gated: skipped unless AGENT_PROVIDER=openai (+ a key) is set — so CI and a
 * normal `pnpm test` never call the network. Run it deliberately, e.g.:
 *   AGENT_PROVIDER=openai OPENAI_API_KEY=… pnpm --filter @evidata/web test eval.live
 * It's a measurement tool (the report is the output), not a hard pass/fail gate.
 */
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
import {
  EVAL_CASES,
  formatReport,
  scoreCase,
  scoreReport,
  type AgentRunEvent,
  type CaseResult,
  type TurnTrace,
} from '@evidata/agent';
import { InvestigationService, type AskResult } from '@evidata/investigation';
import {
  OpenAIAgentProvider,
  openAIConfigFromEnv,
  type ProviderUsage,
} from '@evidata/provider-openai';

const cfg = openAIConfigFromEnv(process.env);

// `queries` comes from the run's ok-query events (a Message carries no queryRuns on
// AskResult), so a message that ran queries before replying is counted, not hidden.
function traceFromAsk(result: AskResult, usage: ProviderUsage, queries: number): TurnTrace {
  const base = { queries, modelCalls: usage.calls, tokens: usage.totalTokens };
  return result.kind === 'message'
    ? { route: result.message.sql ? 'draft_sql' : 'reply', status: 'message', ...base }
    : { route: 'answer', status: result.answer.status, ...base };
}

describe.runIf(cfg)('agent eval — live model', () => {
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

  it('runs the labeled cases and reports routing/answered/queries/tokens', async () => {
    const results: CaseResult[] = [];
    for (const c of EVAL_CASES) {
      const provider = new OpenAIAgentProvider(cfg!); // one stateful provider per turn
      let queries = 0;
      const result = await service.ask(
        { dataSourceId: 'sample', question: c.question, language: c.lang },
        {
          provider,
          sink: (e: AgentRunEvent) => {
            if (e.type === 'query' && e.status === 'ok') queries += 1;
          },
        },
      );
      results.push(scoreCase(c, traceFromAsk(result, provider.usage, queries)));
    }
    const report = scoreReport(results);
    // The report IS the deliverable — print it for inspection.
    // eslint-disable-next-line no-console
    console.log(`\n${formatReport(report)}\n`);
    expect(report.total).toBe(EVAL_CASES.length);
  }, 300_000);
});
