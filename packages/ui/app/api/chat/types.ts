/** Tool result shape sent in done event and used by client. */
export type ChatStreamToolResult = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
};

/** Interactive prompt when status is waiting_for_input. */
export type ChatStreamInteractivePrompt = {
  question: string;
  options?: string[];
};

/** Discriminated union of chat stream event types. */
export type ChatStreamEvent =
  | { type: "trace_step"; phase: string; label?: string; contentPreview?: string; messageCount?: number; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
  | { type: "rephrased_prompt"; rephrasedPrompt: string }
  | { type: "plan"; reasoning?: string; todos?: string[] }
  | { type: "step_start"; stepIndex: number; toolName?: string; todoLabel?: string; subStepLabel?: string }
  | { type: "todo_done"; index: number }
  | {
      type: "done";
      content?: string;
      toolResults?: ChatStreamToolResult[];
      status?: "completed" | "waiting_for_input";
      interactivePrompt?: ChatStreamInteractivePrompt;
      messageId?: string;
      userMessageId?: string;
      conversationId?: string;
      conversationTitle?: string;
      reasoning?: string;
      todos?: string[];
      completedStepIndices?: number[];
      rephrasedPrompt?: string;
    }
  | { type: "error"; error?: string; messageId?: string; userMessageId?: string };

/** Type guard: event is a done event. */
export function isChatStreamDoneEvent(event: { type: string }): event is Extract<ChatStreamEvent, { type: "done" }> {
  return event.type === "done";
}

/** Type guard: event is an error event. */
export function isChatStreamErrorEvent(event: { type: string }): event is Extract<ChatStreamEvent, { type: "error" }> {
  return event.type === "error";
}
