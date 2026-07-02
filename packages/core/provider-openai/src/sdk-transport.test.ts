import { afterEach, describe, expect, it, vi } from 'vitest';
import { reasoningProviderOptions, sdkComplete } from './sdk-transport';
import type { CompletionRequest } from './types';

describe('reasoningProviderOptions (epic #106)', () => {
  it('maps a set effort to the openai-compatible reasoningEffort option', () => {
    // The @ai-sdk/openai-compatible provider turns openaiCompatible.reasoningEffort
    // into the `reasoning_effort` request field.
    expect(reasoningProviderOptions('low')).toEqual({
      openaiCompatible: { reasoningEffort: 'low' },
    });
    expect(reasoningProviderOptions('high')).toEqual({
      openaiCompatible: { reasoningEffort: 'high' },
    });
  });

  it('omits provider options when no effort is set (non-reasoning models unaffected)', () => {
    expect(reasoningProviderOptions(undefined)).toBeUndefined();
    expect(reasoningProviderOptions('')).toBeUndefined();
  });
});

// A request-level assertion that effort actually reaches the chat-completions body
// (not just the helper shape): stub fetch, run the transport, inspect the wire.
describe('sdkComplete effort on the wire (epic #106)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const baseReq: CompletionRequest = {
    model: 'o4-mini',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'final_answer',
          description: 'answer',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'final_answer' } },
    temperature: 0,
    max_tokens: 16,
  };

  function stubFetchCapturing(content = 'ok'): () => unknown {
    let body: unknown;
    vi.stubGlobal('fetch', (_url: string, init?: { body?: string }) => {
      body = init?.body ? JSON.parse(init.body) : undefined;
      const payload = {
        id: '1',
        object: 'chat.completion',
        created: 0,
        model: 'o4-mini',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    return () => body;
  }

  it('sends reasoning_effort when the config carries an effort', async () => {
    const read = stubFetchCapturing();
    const complete = sdkComplete({
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      model: 'o4-mini',
      effort: 'low',
    });
    await complete(baseReq, {});
    expect((read() as Record<string, unknown>).reasoning_effort).toBe('low');
  });

  it('omits reasoning_effort when no effort is set', async () => {
    const read = stubFetchCapturing();
    const complete = sdkComplete({
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      model: 'o4-mini',
    });
    await complete(baseReq, {});
    expect((read() as Record<string, unknown>).reasoning_effort).toBeUndefined();
  });

  it('passes the leading system prompt through the SDK system option without warning', async () => {
    const read = stubFetchCapturing();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const complete = sdkComplete({
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      model: 'o4-mini',
    });
    await complete(
      {
        ...baseReq,
        messages: [
          { role: 'system', content: 'You are careful.' },
          { role: 'user', content: 'hi' },
        ],
      },
      {},
    );
    expect(warn).not.toHaveBeenCalled();
    expect(read()).toBeDefined();
  });

  it('throws if a system message remains in the messages array', async () => {
    const read = stubFetchCapturing();
    const complete = sdkComplete({
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      model: 'o4-mini',
    });
    await expect(
      complete(
        {
          ...baseReq,
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'system', content: 'late system' },
          ],
        },
        {},
      ),
    ).rejects.toThrow(/System messages/);
    expect(read()).toBeUndefined();
  });

  it('omits tools for structured-output requests (#118)', async () => {
    const read = stubFetchCapturing('{"action":"reply","arguments":{"text":"ok"}}');
    const complete = sdkComplete({
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      model: 'o4-mini',
      structuredOutput: true,
    });
    await complete(
      {
        model: 'o4-mini',
        messages: [{ role: 'user', content: 'Return the action JSON.' }],
        output_schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string' },
            arguments: { type: 'object' },
          },
          required: ['action', 'arguments'],
        },
        temperature: 0,
        max_tokens: 16,
      },
      {},
    );
    const body = read() as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect((body.response_format as Record<string, unknown>).type).toBe('json_schema');
  });
});
