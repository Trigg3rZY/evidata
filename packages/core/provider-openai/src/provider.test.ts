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

  it('records only the acted-on tool_call when the model returns several (avoids HTTP 400)', async () => {
    // DeepSeek sometimes emits multiple tool_calls in one turn; the transcript must
    // keep only the one we answer, or the next request has unanswered tool_calls.
    const { complete, calls } = scripted([
      {
        content: null,
        tool_calls: [
          toolCall('a1', 'run_sql', { purpose: 'first', sql: 'select 1' }),
          toolCall('a2', 'run_sql', { purpose: 'second', sql: 'select 2' }),
        ],
      },
      {
        content: null,
        tool_calls: [
          toolCall('a3', 'final_answer', {
            status: 'Answered',
            directAnswer: 'done',
            confidence: 'Medium',
            confidenceReason: 'r',
            keyFindings: [{ text: 'f', evidenceIds: ['E1'] }],
          }),
        ],
      },
    ]);
    const p = provider(complete);
    const history = emptyHistory();

    const d1 = await p.next(input, history);
    expect(d1).toEqual({ kind: 'query', proposal: { purpose: 'first', sql: 'select 1' } });

    history.toolResults.push({
      evidenceRef: 'E1',
      purpose: 'first',
      columns: [],
      sampleRows: [],
      rowCount: 0,
      truncated: false,
      redactedColumns: [],
    });
    await p.next(input, history);

    // the assistant turn in the 2nd request kept only the single acted-on call (a1),
    // and exactly one tool response (for a1) follows it.
    const assistantMsg = calls[1]?.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    expect(assistantMsg?.tool_calls).toHaveLength(1);
    expect(assistantMsg?.tool_calls?.[0]?.id).toBe('a1');
    const toolMsgs = calls[1]?.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs?.[0]?.tool_call_id).toBe('a1');
  });

  it('accumulates token usage and model call count across turns', async () => {
    const { complete } = scripted([
      {
        content: null,
        tool_calls: [toolCall('c1', 'run_sql', { purpose: 'p', sql: 'select 1' })],
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      },
      {
        content: null,
        tool_calls: [
          toolCall('c2', 'final_answer', {
            status: 'Answered',
            directAnswer: 'done',
            confidence: 'High',
            confidenceReason: 'r',
            keyFindings: [{ text: 'f', evidenceIds: ['E1'] }],
          }),
        ],
        usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
      },
    ]);
    const p = provider(complete);
    const history = emptyHistory();
    await p.next(input, history);
    history.toolResults.push({
      evidenceRef: 'E1',
      purpose: 'p',
      columns: [],
      sampleRows: [],
      rowCount: 0,
      truncated: false,
      redactedColumns: [],
    });
    await p.next(input, history);
    expect(p.usage).toEqual({
      promptTokens: 250,
      completionTokens: 50,
      totalTokens: 300,
      calls: 2,
    });
  });

  it('counts calls even when the provider omits a usage field', async () => {
    const { complete } = scripted([
      { content: null, tool_calls: [toolCall('c1', 'cannot_answer', { missing: [] })] },
    ]);
    const p = provider(complete);
    await p.next(input, emptyHistory());
    expect(p.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 1 });
  });

  it('seeds prior turns into the transcript for a follow-up', async () => {
    const { complete, calls } = scripted([
      { content: null, tool_calls: [toolCall('c1', 'reply', { text: 'ok' })] },
    ]);
    const followup: AgentInput = {
      ...input,
      history: [{ question: 'first question', answer: 'first direct answer' }],
    };
    await provider(complete).next(followup, emptyHistory());
    const msgs = calls[0]?.messages ?? [];
    // The seeded prefix: system, the prior (user, assistant) pair, then the current
    // question. (A trailing assistant turn is appended after the call returns — the
    // request shares the live transcript array — so assert the prefix.)
    expect(msgs.slice(0, 4).map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1]?.content).toBe('first question');
    expect(msgs[2]?.content).toBe('first direct answer');
    expect(msgs[3]?.content).toBe(input.question);
  });

  it('maps reply → a Message decision (no data claim, no evidence)', async () => {
    const { complete } = scripted([
      {
        content: null,
        tool_calls: [toolCall('c1', 'reply', { text: 'Hi! Ask me about the data.' })],
      },
    ]);
    const d = await provider(complete).next(input, emptyHistory());
    expect(d).toEqual({ kind: 'message', text: 'Hi! Ask me about the data.' });
  });

  it('maps draft_sql → a Message decision carrying the unexecuted SQL', async () => {
    const { complete } = scripted([
      {
        content: null,
        tool_calls: [
          toolCall('c1', 'draft_sql', {
            sql: 'DELETE FROM campaign_spend WHERE amount > 30',
            explanation: 'Deletes rows over 30 (not executed).',
          }),
        ],
      },
    ]);
    const d = await provider(complete).next(input, emptyHistory());
    if (d.kind !== 'message') throw new Error('expected a message');
    expect(d.sql).toBe('DELETE FROM campaign_spend WHERE amount > 30');
    expect(d.text).toContain('Deletes rows over 30');
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

  it('responds to a rejected final_answer with the violations on re-prompt', async () => {
    const final = (id: string, ev: string) =>
      toolCall(id, 'final_answer', {
        status: 'Answered',
        directAnswer: 'x',
        confidence: 'High',
        confidenceReason: 'r',
        keyFindings: [{ text: 'f', evidenceIds: [ev] }],
      });
    const { complete, calls } = scripted([
      { content: null, tool_calls: [final('cf1', 'E9')] },
      { content: null, tool_calls: [final('cf2', 'E1')] },
    ]);
    const p = provider(complete);
    const history = emptyHistory();

    const d1 = await p.next(input, history);
    expect(d1.kind).toBe('final');

    // the runner would reject d1 and re-prompt with the violations
    history.validationFeedback = ['finding cites unknown evidence E9'];
    const d2 = await p.next(input, history);
    expect(d2.kind).toBe('final');

    // the 2nd request answered the pending final_answer tool_call with the feedback
    const toolMsg = calls[1]?.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'cf1');
    expect(toolMsg?.content).toContain('E9');
  });

  it('forces final_answer on the last budget step (mustFinalize)', async () => {
    const { complete, calls } = scripted([
      {
        content: null,
        tool_calls: [
          toolCall('cf', 'final_answer', {
            status: 'Answered',
            directAnswer: 'best effort',
            confidence: 'Low',
            confidenceReason: 'step limit',
            keyFindings: [{ text: 'f', evidenceIds: ['E1'] }],
          }),
        ],
      },
    ]);
    const d = await provider(complete).next(input, {
      toolResults: [],
      reasoning: [],
      mustFinalize: true,
    });
    expect(d.kind).toBe('final');
    expect(calls[0]?.tool_choice).toEqual({ type: 'function', function: { name: 'final_answer' } });
    expect(
      calls[0]?.messages.some((m) => m.role === 'user' && /last step/i.test(m.content ?? '')),
    ).toBe(true);
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

  // Hand-built raw arguments (not JSON.stringify) reproduce DeepSeek's tool-call
  // defects — strict JSON.parse rejects these, but the provider repairs and recovers.
  const rawFinal = (rawArgs: string): AssistantMessage => ({
    content: null,
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'final_answer', arguments: rawArgs } },
    ],
  });

  it('recovers a final_answer with unescaped ASCII double-quotes inside string values', async () => {
    const raw =
      '{"status": "Answered", "directAnswer": "增长来自新增的 "Summer Sale" 活动", "confidence": "High", "confidenceReason": "数据来自 "campaign_spend" 表", "keyFindings": [{"text": "活动 "Summer Sale" 贡献了全部增长", "evidenceIds": ["E1"]}]}';
    const d = await provider(scripted([rawFinal(raw)]).complete).next(input, emptyHistory());
    if (d.kind !== 'final') throw new Error('expected final');
    expect(d.draft.directAnswer).toContain('Summer Sale');
    expect(d.draft.confidenceReason).toContain('campaign_spend');
    expect(d.draft.keyFindings).toHaveLength(1);
    expect(d.draft.keyFindings[0]?.evidenceIds).toEqual(['E1']);
  });

  it('recovers a final_answer with raw control characters inside string values', async () => {
    // the \n / \t below are ACTUAL control chars in the source, i.e. invalid JSON
    const raw =
      '{"status":"Answered","directAnswer":"第一行\n第二行\t缩进","confidence":"High","confidenceReason":"r","keyFindings":[{"text":"f","evidenceIds":["E1"]}]}';
    const d = await provider(scripted([rawFinal(raw)]).complete).next(input, emptyHistory());
    if (d.kind !== 'final') throw new Error('expected final');
    expect(d.draft.directAnswer).toContain('第一行');
    expect(d.draft.directAnswer).toContain('第二行');
    expect(d.draft.keyFindings).toHaveLength(1);
  });

  it('fails closed (empty draft) on the known repair gap — never a silently-wrong answer', async () => {
    // A content quote immediately before a structural char ("对",) is misread as the
    // terminator and NOT repaired. The draft must come back empty (→ contract reject
    // / honest non-answer), not silently altered. See lenientJson KNOWN GAP.
    const raw =
      '{"status":"Answered","directAnswer":"他说"对",然后离开了","confidence":"High","confidenceReason":"r","keyFindings":[{"text":"f","evidenceIds":["E1"]}]}';
    const d = await provider(scripted([rawFinal(raw)]).complete).next(input, emptyHistory());
    if (d.kind !== 'final') throw new Error('expected final');
    expect(d.draft.directAnswer).toBe('');
    expect(d.draft.keyFindings).toHaveLength(0);
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

  it('ignores a non-numeric AGENT_MAX_TOKENS (no max_tokens: NaN)', () => {
    expect(
      openAIConfigFromEnv({
        AGENT_PROVIDER: 'openai',
        DEEPSEEK_API_KEY: 'k',
        AGENT_MAX_TOKENS: 'lots',
      }),
    ).not.toHaveProperty('maxTokens');
    expect(
      openAIConfigFromEnv({
        AGENT_PROVIDER: 'openai',
        DEEPSEEK_API_KEY: 'k',
        AGENT_MAX_TOKENS: '2048',
      }),
    ).toMatchObject({ maxTokens: 2048 });
  });
});
