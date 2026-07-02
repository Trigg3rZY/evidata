/**
 * Minimal OpenAI-compatible chat types — just what the tool-use loop needs.
 * Kept local (no SDK dependency) so the transport is a plain typed `fetch` and
 * the provider is trivially testable with an injected `Complete` function.
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolChoice = 'required' | { type: 'function'; function: { name: string } };

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: ToolChoice;
  /** JSON schema for non-tool structured-output models. */
  output_schema?: Record<string, unknown>;
  temperature: number;
  max_tokens: number;
}

/** Per-completion token counts (OpenAI `usage`, normalized to camelCase). */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Cumulative provider cost for one Investigation turn: tokens + model round-trips. */
export interface ProviderUsage extends TokenUsage {
  calls: number;
}

export interface AssistantMessage {
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: TokenUsage;
}

/** The single side-effecting call; the default wraps `fetch`, tests inject a fake. */
export type Complete = (
  req: CompletionRequest,
  opts: { signal?: AbortSignal },
) => Promise<AssistantMessage>;

export interface OpenAIProviderConfig {
  apiKey: string;
  /** OpenAI-compatible base, e.g. https://api.deepseek.com (DeepSeek) or https://api.openai.com/v1. */
  baseURL: string;
  model: string;
  maxTokens?: number;
  /** Reasoning effort for reasoning models (OpenAI `reasoning_effort`: low|medium|high).
   *  Sent only when set; ignored by models without a reasoning knob (epic #106). */
  effort?: string;
  /** Use JSON structured output instead of tool calls for no-tool models (#118). */
  structuredOutput?: boolean;
}
