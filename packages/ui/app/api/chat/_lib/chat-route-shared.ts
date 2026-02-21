/**
 * Shared constants and helpers for the chat route and heap turn.
 * Extracted from route.ts for reuse and testability.
 */
import type { LLMMessage, PlannerOutput } from "@agentron-studio/runtime";
import { BLOCK_AGENTIC_PATTERNS, BLOCK_DESIGN_AGENTS } from "@agentron-studio/runtime";

export const DEFAULT_RECENT_SUMMARIES_COUNT = 3;
export const MIN_SUMMARIES = 1;
export const MAX_SUMMARIES = 10;
/** Number of last messages (user + assistant) to include per recent conversation so the user can reference "the output" or "what you said". */
export const LAST_MESSAGES_PER_RECENT_CHAT = 6;

/** In-memory store of pending plan per conversation (when last turn ended with ask_user). Cleared when turn completes without ask_user or on restart. */
export const pendingPlanByConversation = new Map<string, PlannerOutput>();

export const TRACE_PAYLOAD_MAX = 400;
/** Heap/improver tool input/output in queue log (planner and specialist tools): allow larger payload for debugging. */
export const TRACE_TOOL_PAYLOAD_MAX = 8000;
/** Max length per tool result when sending in done event (SSE must JSON.stringify; avoid huge/circular payloads). */
export const DONE_TOOL_RESULT_MAX = 8000;

export function truncateForTrace(v: unknown): unknown {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= TRACE_PAYLOAD_MAX ? v : s.slice(0, TRACE_PAYLOAD_MAX) + "…";
}

/** Cap value for queue log (planner/improver debugging); use for heap_tool/heap_tool_done and planner steps. */
export function capForTrace(v: unknown, maxLen: number): unknown {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= maxLen ? v : s.slice(0, maxLen) + "…";
}

/** improve_agents_workflows specialist: cannot create agents/workflows paragraph. Exported for tests. */
export const IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE =
  "You cannot create agents or workflows (you do not have create_agent or create_workflow). If the plan says to create an agent and/or workflow, do not ask the user for creation parameters (vault id, agent name, etc.); the agent and workflow specialists will create them.";

/** Agent specialist / classical assistant: clarify which improvement mechanism(s) before creating agents. Exported for tests. */
export const AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION =
  'When the user asks for a self-learning, self-improving, or improvement agent: first clarify which kind. If the user did NOT explicitly ask for "model training", "fine-tune", "train a model", or "training pipeline", you MUST call ask_user before creating any agent. Ask which improvement(s) they want: (1) Workflow topology — change edges, add/remove agents in the workflow. (2) Agent improvement — change which tools agents use and their prompts. (3) Prompt improvement — refine system prompts from feedback (audited, rollbackable via apply_agent_prompt_improvement). (4) Model training — fine-tune models from data/feedback. Offer options e.g. "Prompt and workflow only" (topology + agents + prompt improvement, no training), "Workflow topology only", "Prompt improvement only", "Also model training", "Explain the difference". Do not include act_training tools (trigger_training, generate_training_data, create_improvement_job, etc.) unless the user chose "Also model training" or the message clearly requested training. Mapping: "Prompt and workflow only" → list_tools with {"category": "improvement", "subset": "prompt_and_topology"}. "Workflow topology only" → {"category": "improvement", "subset": "topology"}. "Prompt improvement only" → {"category": "improvement", "subset": "prompt"}. "Also model training" → list_tools with {"category": "improvement"} (no subset). If the user chose "Explain the difference", do not create an agent; explain the four mechanisms and tool subsets. If the user has not provided feedback and did not explicitly ask for training, prefer offering "Prompt and workflow only" first. If the combined tools (improvement + browser/vault/fetch/write the user needs) would exceed 10, design a multi-agent system (see below). Otherwise you may create one agent with at most 10 toolIds.';

/** Agent specialist: full agentic patterns + design-agents blocks from runtime. Exported for tests. */
export const AGENT_SPECIALIST_AGENTIC_BLOCKS =
  BLOCK_AGENTIC_PATTERNS + "\n\n" + BLOCK_DESIGN_AGENTS;

/** Extract content string from LLM response.raw when content is empty (e.g. OpenAI-style choices[0].message.content). Exported for unit tests. */
export function extractContentFromRawResponse(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw !== "object") return String(raw);
  const obj = raw as Record<string, unknown>;
  // OpenAI-style: { choices: [{ message: { content: string | Array<{ text }> } }] }
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const msg = (choices[0] as Record<string, unknown>)?.message as
      | Record<string, unknown>
      | undefined;
    const c = msg?.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      return c
        .map((part) =>
          part && typeof part === "object" && typeof (part as { text?: string }).text === "string"
            ? (part as { text: string }).text
            : ""
        )
        .filter(Boolean)
        .join("")
        .trim();
    }
  }
  return "";
}

/** Produce a JSON-serializable copy of the done event so SSE never throws when stringifying. */
export function sanitizeDonePayload(payload: {
  type: "done";
  content?: string;
  toolResults?: { name: string; args: Record<string, unknown>; result: unknown }[];
  status?: string;
  interactivePrompt?: {
    question: string;
    options?: string[];
    stepIndex?: number;
    stepTotal?: number;
  };
  messageId?: string;
  userMessageId?: string;
  conversationId?: string;
  conversationTitle?: string;
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
  rephrasedPrompt?: string;
  planSummary?: { refinedTask: string; route: (string | { parallel: string[] })[] };
}): Record<string, unknown> {
  const safeResult = (v: unknown): unknown => {
    if (v == null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string")
      return v.length <= DONE_TOOL_RESULT_MAX ? v : v.slice(0, DONE_TOOL_RESULT_MAX) + "…";
    if (Array.isArray(v)) return v.slice(0, 50).map(safeResult);
    if (typeof v === "object") {
      try {
        const s = JSON.stringify(v);
        if (s.length <= DONE_TOOL_RESULT_MAX) return JSON.parse(s) as unknown;
        return { _truncated: true, preview: s.slice(0, 200) + "…" };
      } catch {
        return { _truncated: true, _reason: "non-serializable" };
      }
    }
    return String(v);
  };
  const toolResults = payload.toolResults?.map((r) => ({
    name: r.name,
    args: typeof r.args === "object" && r.args !== null ? r.args : {},
    result: safeResult(r.result),
  }));
  return {
    type: "done",
    ...(payload.content !== undefined && { content: payload.content }),
    ...(toolResults !== undefined && { toolResults }),
    ...(payload.status !== undefined && { status: payload.status }),
    ...(payload.interactivePrompt !== undefined && {
      interactivePrompt: payload.interactivePrompt,
    }),
    ...(payload.messageId !== undefined && { messageId: payload.messageId }),
    ...(payload.userMessageId !== undefined && { userMessageId: payload.userMessageId }),
    ...(payload.conversationId !== undefined && { conversationId: payload.conversationId }),
    ...(payload.conversationTitle !== undefined && {
      conversationTitle: payload.conversationTitle,
    }),
    ...(payload.reasoning !== undefined && { reasoning: payload.reasoning }),
    ...(payload.todos !== undefined && { todos: payload.todos }),
    ...(payload.completedStepIndices !== undefined && {
      completedStepIndices: payload.completedStepIndices,
    }),
    ...(payload.rephrasedPrompt !== undefined && { rephrasedPrompt: payload.rephrasedPrompt }),
    ...(payload.planSummary !== undefined && { planSummary: payload.planSummary }),
  };
}

/** Build recent-conversation string for the planner (last N messages, full content). Optionally append current user message. No length cap — we pass full content so behaviour stays user-friendly. */
export function buildRecentConversationContext(
  history: LLMMessage[],
  maxMessages: number,
  options?: { appendCurrentMessage?: string }
): string {
  const recent = history.slice(-maxMessages);
  const parts = recent.map((m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    return `${m.role}: ${content}`;
  });
  let out = parts.join("\n");
  if (options?.appendCurrentMessage && options.appendCurrentMessage.trim()) {
    out += `\nuser: ${options.appendCurrentMessage.trim()}`;
  }
  return out;
}
