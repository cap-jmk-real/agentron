/**
 * LLM request/response types and provider adapter interface.
 *
 * @packageDocumentation
 */
import type { LLMConfig, LLMProvider } from "@agentron-studio/core";

/** Single message in a chat: role, content, optional toolCallId (tool messages) or toolCalls (assistant). */
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

/** Chat request: messages and optional temperature, maxTokens, topP, tools. */
export type LLMRequest = {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Tool definitions for function calling; when provided, the model may return tool_calls instead of content */
  tools?: LLMToolDef[];
};

/** A single tool call in an LLM response: id, name, arguments string. */
export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** Optional context for rate-limit queue visibility (e.g. show "workflow X waiting"). */
export type LLMRequestContext = {
  source: "chat" | "workflow" | "agent";
  workflowId?: string;
  executionId?: string;
  agentId?: string;
};

/** Token usage for a completion. */
export type LLMUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Chat response: id, content, optional toolCalls and usage, raw provider payload. */
export type LLMResponse = {
  id: string;
  content: string;
  /** When the model chose to call tools instead of or in addition to content */
  toolCalls?: LLMToolCall[];
  usage?: LLMUsage;
  raw: unknown;
};

/** LLM config with API key resolved (from vault or extra). */
export type ResolvedLLMConfig = LLMConfig & {
  apiKey?: string;
};

/** Adapter for an LLM provider: chat() and optional validateConfig(). */
export type LLMProviderAdapter = {
  provider: LLMProvider;
  chat: (config: ResolvedLLMConfig, request: LLMRequest) => Promise<LLMResponse>;
  validateConfig?: (config: ResolvedLLMConfig) => Promise<void>;
};
