/**
 * SDK-backed transport (epic #106): implements the same `Complete` contract as the
 * old hand-rolled fetch, but routes the chat-completions call through the Vercel AI
 * SDK (`generateText`). This keeps the whole tool-use loop + its hardening
 * (force-finalize, one-tool-call-per-turn, re-prompt-once, usage) untouched — only
 * the transport changes — while gaining provider normalization, tool/argument
 * parsing, and transient retry from the SDK.
 */
import {
  generateText,
  jsonSchema,
  tool,
  InvalidToolInputError,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { lenientJson } from './json-repair';
import type {
  AssistantMessage,
  ChatMessage,
  Complete,
  OpenAIProviderConfig,
  ToolChoice,
  ToolDef,
} from './types';

export function sdkComplete(cfg: OpenAIProviderConfig): Complete {
  const provider = createOpenAICompatible({
    name: 'evidata',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
  });
  const model = provider(cfg.model);

  return async (req, opts): Promise<AssistantMessage> => {
    try {
      const result = await generateText({
        model,
        messages: toModelMessages(req.messages),
        tools: toSdkTools(req.tools),
        toolChoice: toSdkToolChoice(req.tool_choice),
        temperature: req.temperature,
        maxOutputTokens: req.max_tokens,
        // Preserve the DeepSeek tool-arg JSON repair (unescaped quotes / control
        // chars): the SDK parses+validates tool input itself and rejects these, so
        // re-run our lenient repair on the raw input before it fails the turn.
        experimental_repairToolCall: ({ toolCall, error }) => {
          if (!InvalidToolInputError.isInstance(error)) return Promise.resolve(null);
          const repaired = lenientJson(toolCall.input);
          // Unrepairable → null lets it fail closed through the answer contract.
          return Promise.resolve(isParseable(repaired) ? { ...toolCall, input: repaired } : null);
        },
        ...(opts.signal ? { abortSignal: opts.signal } : {}),
      });
      return {
        content: result.text ? result.text : null,
        ...(result.toolCalls.length
          ? {
              tool_calls: result.toolCalls.map((tc) => ({
                id: tc.toolCallId,
                type: 'function' as const,
                function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) },
              })),
            }
          : {}),
        usage: {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
        },
      };
    } catch (err) {
      // Surface a client cancellation as AbortError so askStream classifies it as a
      // cancellation (not a failure) — matching the old fetch transport's behavior.
      if (opts.signal?.aborted) {
        const aborted = new Error('AI provider request aborted');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw err;
    }
  };
}

/** Our tools have no `execute`: we want the model's tool CALL back (the runner
 *  executes), so generateText returns after a single step with the call. */
function toSdkTools(defs: ToolDef[]): ToolSet {
  const tools: ToolSet = {};
  for (const d of defs) {
    tools[d.function.name] = tool({
      description: d.function.description,
      inputSchema: jsonSchema(d.function.parameters),
    });
  }
  return tools;
}

function toSdkToolChoice(tc: ToolChoice): 'required' | { type: 'tool'; toolName: string } {
  return tc === 'required' ? 'required' : { type: 'tool', toolName: tc.function.name };
}

/** Convert our OpenAI-shaped transcript to the SDK's v6 ModelMessage parts. */
function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  // tool-result parts require the toolName; recover it from the assistant tool_calls.
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.tool_calls ?? []) toolNameById.set(tc.id, tc.function.name);
  }

  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content ?? '' });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content ?? '' });
    } else if (m.role === 'assistant') {
      if (m.tool_calls?.length) {
        out.push({
          role: 'assistant',
          content: m.tool_calls.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: safeParse(tc.function.arguments),
          })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content ?? '' });
      }
    } else {
      // role === 'tool'
      const id = m.tool_call_id ?? '';
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: id,
            toolName: toolNameById.get(id) ?? 'unknown',
            output: { type: 'text', value: m.content ?? '' },
          },
        ],
      });
    }
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function isParseable(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
