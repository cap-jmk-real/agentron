export type ChatRole = "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/** One LLM call: request summary and response for stack trace. */
export interface LLMTraceCall {
  /** e.g. "main" | "rephrase" | "nudge" | "follow_up" */
  phase?: string;
  /** Number of messages in the request. */
  messageCount?: number;
  /** Last user message (truncated) for context. */
  lastUserContent?: string;
  /** Full request messages (optional, can be large). */
  requestMessages?: Array<{ role: string; content: string }>;
  /** Model response content (full or truncated for storage). */
  responseContent?: string;
  /** First N chars of response for preview. */
  responsePreview?: string;
  /** Token usage if available. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: ChatToolCall[];
  /** LLM request/response trace for this message (assistant only). */
  llmTrace?: LLMTraceCall[];
  /** Rephrased user intent for this turn (assistant only; shown in UI and trace). */
  rephrasedPrompt?: string | null;
  createdAt: number;
  conversationId?: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  rating: number | null; // 1-5 or 0 for unset
  note: string | null;
  summary: string | null;
  lastUsedProvider: string | null;
  lastUsedModel: string | null;
  createdAt: number;
}

export interface ChatAssistantSettings {
  id: string;
  customSystemPrompt: string | null;
  contextAgentIds: string[] | null;
  contextWorkflowIds: string[] | null;
  contextToolIds: string[] | null;
  /** How many recent conversation summaries to include in context (1–10). Default 3. */
  recentSummariesCount: number | null;
  /** LLM temperature (0–2). Null = use default 0.7. Some models only support 1. */
  temperature: number | null;
  /** When conversation history exceeds this many messages, older messages are summarized. Default 24. */
  historyCompressAfter: number | null;
  /** When compressing, keep this many most recent messages in full. Default 16. Must be less than historyCompressAfter. */
  historyKeepRecent: number | null;
  updatedAt: number;
}

export interface AssistantMemoryEntry {
  id: string;
  key: string | null;
  content: string;
  createdAt: number;
}
