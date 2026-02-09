export type ChatRole = "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: ChatToolCall[];
  createdAt: number;
  conversationId?: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  rating: number | null; // 1-5 or 0 for unset
  note: string | null;
  summary: string | null;
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
  updatedAt: number;
}

export interface AssistantMemoryEntry {
  id: string;
  key: string | null;
  content: string;
  createdAt: number;
}
