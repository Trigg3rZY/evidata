// @evidata/provider-openai — OpenAI-compatible AgentProvider (DeepSeek, OpenAI, …).
export { OpenAIAgentProvider, openAIConfigFromEnv } from './provider';
export { sdkComplete } from './sdk-transport';
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
