import { describe, expect, it } from 'vitest';
import type { AgentHistory, AgentInput, ToolResult } from '@evidata/agent';
import { OpenAIAgentProvider, openAIConfigFromEnv } from './index';
import type { AssistantMessage, Complete, CompletionRequest, ToolCall } from './types';

const input: AgentInput = {
  investigationId: 'inv1',
  question: 'why is spend up?',
  language: 'en',
  schema: {
    dataSourceId: 'sample',
    capturedAt: '2026-06-18T00:00:00Z',
    partial: false,
    tables: [
      {
        name: 'campaign_spend',
        columns: [{ name: 'amount', dataType: 'numeric', nullable: false }],
      },
    ],
  },
  context: {
    overview: 'demo',
    glossary: [{ term: 'spend', definition: "amount where status='posted'" }],
    mappings: [{ from: 'Customer', to: 'accounts.id' }],
  },
};

const emptyHistory = (): AgentHistory => ({ toolResults: [], reasoning: [] });

function scripted(script: AssistantMessage[]): { complete: Complete; calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  let i = 0;
  const complete: Complete = (req) => {
    calls.push(req);
    return Promise.resolve(script[i++] ?? { content: null });
  };
  return { complete, calls };
}

const toolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const provider = (complete: Complete) =>
  new OpenAIAgentProvider({ apiKey: 'x', baseURL: 'http://localhost', model: 'm' }, complete);

describe('OpenAIAgentProvider', () => {
  it('maps run_sql → query, feeds the redacted result back, then final_answer → final', async () => {
    const { complete, calls } = scripted([
      {
        content: 'checking',
        tool_calls: [toolCall('c1', 'run_sql', { purpose: 'compare', sql: 'select 1' })],
      },
      {
        content: null,
        tool_calls: [
          toolCall('c2', 'final_answer', {
            status: 'Answered',
            directAnswer: 'up 38%',
            confidence: 'Medium',
            confidenceReason: 'single source',
            keyFindings: [{ text: 'rose', evidenceIds: ['E1'] }],
          }),
        ],
      },
    ]);
    const p = provider(complete);
    const history = emptyHistory();

    const d1 = await p.next(input, history);
    expect(d1).toEqual({ kind: 'query', proposal: { purpose: 'compare', sql: 'select 1' } });

    // simulate the runner executing + recording the redacted result
    const tr: ToolResult = {
      evidenceRef: 'E1',
      purpose: 'compare',
      columns: [{ name: 'total', dataType: 'numeric' }],
      sampleRows: [{ total: 48200 }],
      rowCount: 1,
      truncated: false,
      redactedColumns: [],
    };
    history.toolResults.push(tr);

    const d2 = await p.next(input, history);
    expect(d2.kind).toBe('final');
    if (d2.kind === 'final') {
      expect(d2.draft.status).toBe('Answered');
      expect(d2.draft.keyFindings[0]?.evidenceIds).toEqual(['E1']);
    }

    // the 2nd request fed the tool result back, bound to the originating call id
    const second = calls[1];
    expect(second?.messages[0]?.role).toBe('system');
    expect(second?.messages[1]?.role).toBe('user');
    const toolMsg = second?.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('c1');
    expect(toolMsg?.content).toContain('"evidenceRef":"E1"');
  });

  it('maps cannot_answer → unblock with the declared missing info', async () => {
    const { complete } = scripted([
      {
        content: null,
        tool_calls: [
          toolCall('c1', 'cannot_answer', {
            missing: [{ kind: 'unverified_mapping', description: 'x↔y' }],
          }),
        ],
      },
    ]);
    const d = await provider(complete).next(input, emptyHistory());
    expect(d.kind).toBe('unblock');
    if (d.kind === 'unblock') expect(d.missing[0].kind).toBe('unverified_mapping');
  });

  it('falls back to an unblock when the model takes no action', async () => {
    const { complete } = scripted([{ content: 'thinking out loud' }]);
    const d = await provider(complete).next(input, emptyHistory());
    expect(d.kind).toBe('unblock');
  });

  it('drops findings without evidence and coerces an invalid confidence', async () => {
    const { complete } = scripted([
      {
        content: null,
        tool_calls: [
          toolCall('c1', 'final_answer', {
            status: 'Answered',
            directAnswer: 'a',
            confidence: 'bogus',
            confidenceReason: 'r',
            keyFindings: [
              { text: 'no evidence', evidenceIds: [] },
              { text: 'cited', evidenceIds: ['E1'] },
            ],
          }),
        ],
      },
    ]);
    const d = await provider(complete).next(input, emptyHistory());
    if (d.kind !== 'final') throw new Error('expected final');
    expect(d.draft.confidence).toBe('Medium');
    expect(d.draft.keyFindings).toHaveLength(1);
    expect(d.draft.keyFindings[0]?.text).toBe('cited');
  });
});

describe('openAIConfigFromEnv', () => {
  it('returns null unless AGENT_PROVIDER=openai and a key is present', () => {
    expect(openAIConfigFromEnv({})).toBeNull();
    expect(openAIConfigFromEnv({ AGENT_PROVIDER: 'openai' })).toBeNull();
    expect(openAIConfigFromEnv({ DEEPSEEK_API_KEY: 'k' })).toBeNull();
  });

  it('defaults to DeepSeek, and honors overrides', () => {
    expect(openAIConfigFromEnv({ AGENT_PROVIDER: 'openai', DEEPSEEK_API_KEY: 'k' })).toMatchObject({
      apiKey: 'k',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
    expect(
      openAIConfigFromEnv({
        AGENT_PROVIDER: 'openai',
        OPENAI_API_KEY: 'k',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        AGENT_MODEL: 'gpt-4o-mini',
      }),
    ).toMatchObject({ baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
  });
});
