import type { LLMConfig, LLMProvider } from "@agentron-studio/core";

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For assistant messages with tool calls; tool messages must have toolCallId */
  toolCallId?: string;
  /** Assistant message that requested tool calls */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
};

/** OpenAI-style tool definition for function calling. name = tool id for mapping. */
export type LLMToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LLMRequest = {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Tool definitions for function calling; when provided, the model may return tool_calls instead of content */
  tools?: LLMToolDef[];
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** Optional context for rate-limit queue visibility (e.g. show "workflow X waiting") */
export type LLMRequestContext = {
  source: "chat" | "workflow" | "agent";
  workflowId?: string;
  executionId?: string;
  agentId?: string;
};

export type LLMUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LLMResponse = {
  id: string;
  content: string;
  /** When the model chose to call tools instead of or in addition to content */
  toolCalls?: LLMToolCall[];
  usage?: LLMUsage;
  raw: unknown;
};

export type ResolvedLLMConfig = LLMConfig & {
  apiKey?: string;
};

export type LLMProviderAdapter = {
  provider: LLMProvider;
  chat: (config: ResolvedLLMConfig, request: LLMRequest) => Promise<LLMResponse>;
  validateConfig?: (config: ResolvedLLMConfig) => Promise<void>;
};
