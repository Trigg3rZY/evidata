// @evidata/provider-openai — OpenAI-compatible AgentProvider (DeepSeek, OpenAI, …).
export { OpenAIAgentProvider, fetchComplete, openAIConfigFromEnv } from './provider';
export { AGENT_TOOLS, buildSystemPrompt } from './tools';
export type {
  AssistantMessage,
  ChatMessage,
  Complete,
  CompletionRequest,
  OpenAIProviderConfig,
  ProviderUsage,
  TokenUsage,
  ToolCall,
  ToolDef,
} from './types';
