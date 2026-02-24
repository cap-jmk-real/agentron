/** Shared chat message types used by chat-modal and chat-section. */

export type ToolResult = { name: string; args: Record<string, unknown>; result: unknown };

export type TraceStep = {
  phase: string;
  label?: string;
  contentPreview?: string;
  inputPreview?: string;
  specialistId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
};

export type InteractivePrompt = {
  question: string;
  options?: string[];
  stepIndex?: number;
  stepTotal?: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: ToolResult[];
  /** Explicit turn status from done event; avoids inferring from toolResults. */
  status?: "completed" | "waiting_for_input";
  /** Interactive prompt from done event when status === "waiting_for_input". */
  interactivePrompt?: InteractivePrompt;
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
  /** Step currently executing (before todo_done); for in-progress indicator */
  executingStepIndex?: number;
  /** Tool name currently executing (from step_start) */
  executingToolName?: string;
  /** Todo label for current step */
  executingTodoLabel?: string;
  /** Optional substep label (e.g. "List LLM providers") */
  executingSubStepLabel?: string;
  /** Rephrased user intent for this turn (shown so user can assess) */
  rephrasedPrompt?: string | null;
  /** Live trace steps during thinking (e.g. "Rephrasing…", "Calling LLM…") */
  traceSteps?: TraceStep[];
};
