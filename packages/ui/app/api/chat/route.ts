import { json } from "../_lib/response";
import { logApiError } from "../_lib/api-logger";
import {
  db, agents, workflows, tools, llmConfigs, executions, files, sandboxes, customFunctions, feedback, conversations, conversationLocks, chatMessages, chatAssistantSettings, assistantMemory, fromChatAssistantSettingsRow, toChatAssistantSettingsRow, fromAssistantMemoryRow, toAssistantMemoryRow,
  tokenUsage, modelPricing, remoteServers, toTokenUsageRow,
  fromAgentRow, fromWorkflowRow, fromToolRow, fromLlmConfigRow, fromLlmConfigRowWithSecret, fromFeedbackRow, fromFileRow, fromSandboxRow, fromModelPricingRow,
  toAgentRow, toWorkflowRow, toToolRow, toCustomFunctionRow, toSandboxRow, toChatMessageRow, fromChatMessageRow, toConversationRow,
  fromRemoteServerRow, toRemoteServerRow,
  ensureStandardTools,
  executionOutputSuccess,
  executionOutputFailure,
  toExecutionRow,
  fromExecutionRow,
  improvementJobs,
  techniqueInsights,
  techniquePlaybook,
  guardrails,
  agentStoreEntries,
  trainingRuns,
  runLogs,
  reminders,
  fromReminderRow,
  toReminderRow,
  insertWorkflowMessage,
  getWorkflowMessages,
  messageQueueLog,
} from "../_lib/db";
import { scheduleReminder, cancelReminderTimeout } from "../_lib/reminder-scheduler";
import { registerScheduledTurnRunner } from "../_lib/run-scheduled-turn";
import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE, WaitingForUserError } from "../_lib/run-workflow";
import { executeTool, enrichAgentToolResult, resolveTemplateVars } from "./_lib/execute-tool";
import { getFeedbackForScope } from "../_lib/feedback-for-scope";
import { getRunForImprovement } from "../_lib/run-for-improvement";
import { enqueueWorkflowResume, processOneWorkflowJob } from "../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../_lib/rag";
import type { RemoteServer } from "../_lib/db";
import { testRemoteConnection } from "../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../_lib/naming";
import { runSerializedByConversation } from "../_lib/chat-queue";
import { publish as channelPublish, finish as channelFinish, setPendingJob, takePendingJob } from "../_lib/chat-event-channel";
import {
  llmContextPrefix,
  normalizeChatError,
  getAskUserQuestionFromToolResults,
  getAssistantDisplayContent,
  getTurnStatusFromToolResults,
  hasWaitingForInputInToolResults,
  getLastAssistantDeleteConfirmContext,
  userMessageMatchesFirstOption,
  normalizeAskUserOptionsInToolResults,
  extractOptionsFromContentWithLLM,
  hasFormatResponseWithContent,
  deriveInteractivePromptFromContentWithLLM,
  normalizeOptionCountInContent,
  buildSpecialistSummaryWithCreatedIds,
  mergeCreatedIdsIntoPlan,
} from "../_lib/chat-helpers";
import { openclawSend, openclawHistory, openclawAbort } from "../_lib/openclaw-client";
import { eq, asc, desc, isNotNull, and, like, inArray } from "drizzle-orm";
import type { LLMTraceCall, LLMConfig } from "@agentron-studio/core";
import { runAssistant, buildFeedbackInjection, createDefaultLLMManager, resolveModelPricing, calculateCost, type StudioContext, searchWeb, fetchUrl, refinePrompt, getRegistry, getToolsForSpecialist, runHeap, buildRouterPrompt, parseRouterOutput, buildPlannerPrompt, buildPlannerContinuationPrompt, parsePlanOutput, enrichTaskWithPlan, expandToLeaves, inferFallbackPriorityOrder, planImpliesCreateAgentAndWorkflow, reorderAgentBeforeWorkflow, reorderAgentAndWorkflowBeforeImproveAgentsWorkflows, PLANNER_RETRY_INSTRUCTION } from "@agentron-studio/runtime";
import type { PlannerOutput } from "@agentron-studio/runtime";
import { getContainerManager, withContainerInstallHint } from "../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../_lib/credential-store";
import { getVaultKeyFromRequest } from "../_lib/vault";
import { loadSpecialistOverrides } from "../_lib/specialist-overrides";
import { createRunNotification, createChatNotification, clearActiveBySourceId } from "../_lib/notifications-store";
import type { LLMMessage, LLMRequest, LLMResponse } from "@agentron-studio/runtime";
import { runShellCommand } from "../_lib/shell-exec";
import {
  getSystemContext,
  buildRunResponseForChat,
  rephraseAndClassify,
  buildContinueShellApprovalMessage,
  shouldSkipRephrase,
  generateConversationTitle,
  summarizeConversation,
  summarizeHistoryChunk,
  DEFAULT_HISTORY_COMPRESS_AFTER,
  DEFAULT_HISTORY_KEEP_RECENT,
  CHAT_ASSISTANT_MAX_TOKENS,
} from "./_lib/run-turn-helpers";

export const runtime = "nodejs";


const DEFAULT_RECENT_SUMMARIES_COUNT = 3;
const MIN_SUMMARIES = 1;
const MAX_SUMMARIES = 10;
/** Number of last messages (user + assistant) to include per recent conversation so the user can reference "the output" or "what you said". */
const LAST_MESSAGES_PER_RECENT_CHAT = 6;

/** In-memory store of pending plan per conversation (when last turn ended with ask_user). Cleared when turn completes without ask_user or on restart. */
const pendingPlanByConversation = new Map<string, PlannerOutput>();

const TRACE_PAYLOAD_MAX = 400;
/** Heap/improver tool input/output in queue log (planner and specialist tools): allow larger payload for debugging. */
const TRACE_TOOL_PAYLOAD_MAX = 8000;
/** Max length per tool result when sending in done event (SSE must JSON.stringify; avoid huge/circular payloads). */
const DONE_TOOL_RESULT_MAX = 8000;

function truncateForTrace(v: unknown): unknown {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= TRACE_PAYLOAD_MAX ? v : s.slice(0, TRACE_PAYLOAD_MAX) + "…";
}

/** Cap value for queue log (planner/improver debugging); use for heap_tool/heap_tool_done and planner steps. */
function capForTrace(v: unknown, maxLen: number): unknown {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= maxLen ? v : s.slice(0, maxLen) + "…";
}

/** improve_agents_workflows specialist: cannot create agents/workflows paragraph. Exported for tests. */
export const IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE =
  "You cannot create agents or workflows (you do not have create_agent or create_workflow). If the plan says to create an agent and/or workflow, do not ask the user for creation parameters (vault id, agent name, etc.); the agent and workflow specialists will create them.";

/** Agent specialist prompt: clarify improvement type (prompt/topology vs model training) before creating agents. Exported for tests. */
export const AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION =
  "When the user asks for a self-learning, self-improving, or improvement agent: first clarify which kind. If the user did NOT explicitly ask for \"model training\", \"fine-tune\", \"train a model\", or \"training pipeline\", you MUST call ask_user before creating any agent: ask \"Do you want (A) Prompt and workflow improvement only (adjust prompts, add/remove agents in the workflow, change how agents connect — no model training), or (B) Also model training (fine-tune from feedback/data)?\" with options e.g. \"Prompt and workflow only\", \"Also model training\", \"Explain the difference\". Do not include act_training tools (trigger_training, generate_training_data, create_improvement_job, etc.) in any created agent unless the user chose \"Also model training\" or the user message already clearly requested training. If the user chose \"Prompt and workflow only\" (or equivalent), call list_tools with {\"category\": \"improvement\", \"subset\": \"prompt_and_topology\"} so the created agent gets only observe + act_prompt + act_topology tools (including adding agents to workflows and changing edges via update_workflow). If they chose \"Also model training\", call list_tools with {\"category\": \"improvement\"} (no subset). If the user has not provided feedback (e.g. get_feedback_for_scope would return empty) and did not explicitly ask for training, prefer offering \"Prompt and workflow only\" as the default or suggest that option first. If the combined tools (improvement + any browser/vault/fetch/write the user needs) would exceed 10, design a multi-agent system (see below). Otherwise you may create one agent with at most 10 toolIds.";

/** Extract content string from LLM response.raw when content is empty (e.g. OpenAI-style choices[0].message.content). Exported for unit tests. */
export function extractContentFromRawResponse(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw !== "object") return String(raw);
  const obj = raw as Record<string, unknown>;
  // OpenAI-style: { choices: [{ message: { content: string | Array<{ text }> } }] }
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const msg = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
    const c = msg?.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      return c
        .map((part) => (part && typeof part === "object" && typeof (part as { text?: string }).text === "string" ? (part as { text: string }).text : ""))
        .filter(Boolean)
        .join("")
        .trim();
    }
  }
  return "";
}

/** Produce a JSON-serializable copy of the done event so SSE never throws when stringifying. */
function sanitizeDonePayload(payload: {
  type: "done";
  content?: string;
  toolResults?: { name: string; args: Record<string, unknown>; result: unknown }[];
  status?: string;
  interactivePrompt?: { question: string; options?: string[]; stepIndex?: number; stepTotal?: number };
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
    if (typeof v === "string") return v.length <= DONE_TOOL_RESULT_MAX ? v : v.slice(0, DONE_TOOL_RESULT_MAX) + "…";
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
    ...(payload.interactivePrompt !== undefined && { interactivePrompt: payload.interactivePrompt }),
    ...(payload.messageId !== undefined && { messageId: payload.messageId }),
    ...(payload.userMessageId !== undefined && { userMessageId: payload.userMessageId }),
    ...(payload.conversationId !== undefined && { conversationId: payload.conversationId }),
    ...(payload.conversationTitle !== undefined && { conversationTitle: payload.conversationTitle }),
    ...(payload.reasoning !== undefined && { reasoning: payload.reasoning }),
    ...(payload.todos !== undefined && { todos: payload.todos }),
    ...(payload.completedStepIndices !== undefined && { completedStepIndices: payload.completedStepIndices }),
    ...(payload.rephrasedPrompt !== undefined && { rephrasedPrompt: payload.rephrasedPrompt }),
    ...(payload.planSummary !== undefined && { planSummary: payload.planSummary }),
  };
}

/** Build recent-conversation string for the planner (last N messages, full content). Optionally append current user message. No length cap — we pass full content so behaviour stays user-friendly. */
function buildRecentConversationContext(
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

/** Run one turn in heap (multi-agent) mode: router LLM → run heap with specialists; returns assistant-shaped result and the plan used (for pending plan storage). */
async function runHeapModeTurn(opts: {
  effectiveMessage: string;
  callLLM: (req: LLMRequest) => Promise<LLMResponse>;
  executeToolCtx: { conversationId: string | undefined; vaultKey: Buffer | null | undefined; registry?: ReturnType<typeof getRegistry> };
  registry: ReturnType<typeof getRegistry>;
  manager: ReturnType<typeof createDefaultLLMManager>;
  llmConfig: LLMConfig | null;
  pushUsage: (response: LLMResponse) => void;
  enqueueTrace?: (step: { phase: string; label?: string; specialistId?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown; contentPreview?: string; /** Heap route from router (for heap_route trace step). */ priorityOrder?: unknown; refinedTask?: string; plannerPrompt?: unknown; rawResponse?: unknown; parsedPlan?: unknown; /** Text extracted from response and used for parsing (so UI can show what was parsed). */ extractedTextForParsing?: string; /** When no plan was derived, human-readable reason (e.g. empty content, finish_reason length). */ noPlanReason?: string; expandedOrder?: unknown; /** Short slice of response.raw for debugging (included whenever provider returns raw). */ rawPreview?: string }) => void;
  /** When set, heap sets this to the current specialist id so LLM trace steps can include specialistId. */
  currentSpecialistIdRef?: { current: string | null };
  /** Short recent conversation for planner (extractedContext and intent). */
  recentConversationContext?: string;
  /** When set, a run is waiting for user input; planner should route to workflow and set instructionsForWorkflow for respond_to_run when user message looks like a direct reply. */
  runWaitingContext?: string;
  /** When set, use continuation prompt (merge) so the plan is updated with the user's reply. */
  pendingPlan?: PlannerOutput | null;
  feedbackInjection?: string;
  ragContext?: string;
  uiContext?: string;
  studioContext?: StudioContext;
  systemPromptOverride?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ content: string; toolResults: { name: string; args: Record<string, unknown>; result: unknown }[]; plan: PlannerOutput | null; refinedTask: string; priorityOrder: (string | { parallel: string[] })[]; reasoning?: string; todos?: string[]; completedStepIndices?: number[] }> {
  const { effectiveMessage, callLLM, executeToolCtx, registry, manager, llmConfig, pushUsage, enqueueTrace, currentSpecialistIdRef } = opts;
  const traceId = crypto.randomUUID();
  enqueueTrace?.({ phase: "router", label: "Planning…" });

  const useContinuationPrompt = opts.pendingPlan != null;
  let plannerPrompt: string;
  if (useContinuationPrompt) {
    plannerPrompt = buildPlannerContinuationPrompt(opts.pendingPlan!, effectiveMessage, registry);
  } else {
    plannerPrompt = buildPlannerPrompt(effectiveMessage, registry, opts.recentConversationContext, opts.runWaitingContext);
  }
  enqueueTrace?.({
    phase: "planner_request",
    label: useContinuationPrompt ? "Planner input (continuation)" : "Planner input",
    plannerPrompt,
  });

  function getPlannerText(res: LLMResponse): string {
    const fromContent = (res.content ?? "").trim();
    if (fromContent.length > 0) return fromContent;
    return extractContentFromRawResponse(res.raw);
  }

  let plannerResponse: LLMResponse | null = null;
  let plannerText = "";
  let plan: PlannerOutput | null = null;
  try {
    plannerResponse = await manager.chat(llmConfig as LLMConfig, {
      messages: [{ role: "user", content: plannerPrompt }],
      temperature: 0.2,
      maxTokens: 8192,
    }, { source: "chat" });
    pushUsage(plannerResponse);
    plannerText = getPlannerText(plannerResponse);
    plan = parsePlanOutput(plannerText);
    if (plan == null && !useContinuationPrompt) {
      plannerResponse = await manager.chat(llmConfig as LLMConfig, {
        messages: [{ role: "user", content: plannerPrompt + PLANNER_RETRY_INSTRUCTION }],
        temperature: 0.2,
        maxTokens: 8192,
      }, { source: "chat" });
      pushUsage(plannerResponse);
      plannerText = getPlannerText(plannerResponse);
      plan = parsePlanOutput(plannerText);
    }
  } finally {
    const rawContent = plannerText;
    const rawToUse =
      plannerResponse?.raw != null
        ? plannerResponse.raw
        : plannerResponse != null
          ? { content: plannerResponse.content, id: plannerResponse.id, usage: plannerResponse.usage }
          : undefined;
    const rawPreviewForTrace =
      rawToUse != null
        ? (typeof rawToUse === "object" ? JSON.stringify(rawToUse) : String(rawToUse))
        : undefined;
    const rawResponseForTrace =
      rawContent.length > 0
        ? rawContent
        : rawPreviewForTrace ?? "(Planner returned no text; no response from provider.)";
    // When no plan was derived, surface reason (e.g. finish_reason "length" = hit token limit before output).
    let noPlanReason: string | undefined;
    if (plan == null && rawToUse != null && typeof rawToUse === "object") {
      const choices = (rawToUse as Record<string, unknown>).choices;
      const fr = Array.isArray(choices) && choices.length > 0
        ? (choices[0] as Record<string, unknown>)?.finish_reason
        : undefined;
      if (rawContent.length === 0) {
        noPlanReason = typeof fr === "string"
          ? `Model returned no text (finish_reason: ${fr}). For reasoning models, increase planner max_tokens so the model can output after reasoning.`
          : "Model returned no text. No plan could be parsed.";
      } else {
        noPlanReason = "Response text could not be parsed as a valid plan (invalid JSON or missing fields).";
      }
    }
    enqueueTrace?.({
      phase: "planner_response",
      label: "Planner output",
      rawResponse: rawResponseForTrace,
      parsedPlan: plan ?? undefined,
      extractedTextForParsing: rawContent.length > 0 ? rawContent : undefined,
      ...(noPlanReason != null && { noPlanReason }),
      ...(rawPreviewForTrace != null && { rawPreview: rawPreviewForTrace }),
    });
  }

  const fallbackOrder =
    plan == null
      ? inferFallbackPriorityOrder(effectiveMessage, opts.recentConversationContext, registry)
      : registry.topLevelIds[0]
        ? [registry.topLevelIds[0]]
        : [];
  const rawOrder = plan?.priorityOrder ?? fallbackOrder;
  const priorityOrder: (string | { parallel: string[] })[] = Array.isArray(rawOrder)
    ? rawOrder
        .map((step) => {
          if (typeof step === "string") return step in registry.specialists ? step : null;
          if (step && typeof step === "object" && Array.isArray((step as { parallel?: string[] }).parallel)) {
            const filtered = (step as { parallel: string[] }).parallel.filter((id) => id in registry.specialists);
            return filtered.length > 0 ? { parallel: filtered } : null;
          }
          return null;
        })
        .filter((s): s is string | { parallel: string[] } => s !== null)
    : fallbackOrder;
  const refinedTask = plan?.refinedTask ?? effectiveMessage;

  const routeLabelPart = priorityOrder
    .map((s) => (typeof s === "string" ? s : Array.isArray((s as { parallel?: string[] }).parallel) ? `[${(s as { parallel: string[] }).parallel.join(", ")}]` : String(s)))
    .join(" → ");
  enqueueTrace?.({
    phase: "heap_route",
    label: `Route: ${routeLabelPart || "—"}`,
    priorityOrder,
    refinedTask,
    ...(plan && {
      extractedContext: plan.extractedContext,
      instructionsForGeneral: plan.instructionsForGeneral,
      instructionsForAgent: plan.instructionsForAgent,
      instructionsForWorkflow: plan.instructionsForWorkflow,
      instructionsForImproveRun: plan.instructionsForImproveRun,
      instructionsForImproveHeap: plan.instructionsForImproveHeap,
      instructionsForImproveAgentsWorkflows: plan.instructionsForImproveAgentsWorkflows,
      instructionsForImprovement: plan.instructionsForImprovement,
      instructionsForImprovementSession: plan.instructionsForImprovementSession,
      instructionsForImprovementHeap: plan.instructionsForImprovementHeap,
    }),
  });

  const chooseSubspecialist = async (optionIds: string[], task: string, parentId: string): Promise<string | null> => {
    if (optionIds.length === 0) return null;
    if (optionIds.length === 1) return optionIds[0];
    try {
      const prompt = `Task: ${task.slice(0, 400)}\nParent specialist: ${parentId}\nWhich subspecialist should handle this? Reply with exactly one id from: ${optionIds.join(", ")}`;
      const res = await manager.chat(llmConfig as LLMConfig, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 128,
      }, { source: "chat" });
      pushUsage(res);
      const text = (res.content ?? "").trim();
      const chosen = optionIds.find((id) => text.includes(id)) ?? optionIds[0];
      return chosen;
    } catch {
      return optionIds[0];
    }
  };

  let orderToRun = priorityOrder;
  try {
    orderToRun = await expandToLeaves(priorityOrder, registry, refinedTask, chooseSubspecialist, 5);
  } catch {
    orderToRun = priorityOrder;
  }
  if (orderToRun !== priorityOrder) {
    enqueueTrace?.({
      phase: "heap_expand",
      label: "Expanded to leaf specialists",
      expandedOrder: orderToRun,
    });
  }

  if (plan && planImpliesCreateAgentAndWorkflow(plan)) {
    let reordered = reorderAgentBeforeWorkflow(orderToRun);
    if (reordered !== orderToRun) {
      orderToRun = reordered;
      enqueueTrace?.({
        phase: "heap_expand",
        label: "Reordered so agent runs before workflow (create-both)",
        expandedOrder: orderToRun,
      });
    }
    reordered = reorderAgentAndWorkflowBeforeImproveAgentsWorkflows(orderToRun);
    if (reordered !== orderToRun) {
      orderToRun = reordered;
      enqueueTrace?.({
        phase: "heap_expand",
        label: "Reordered so agent and workflow run before improve_agents_workflows (create-both)",
        expandedOrder: orderToRun,
      });
    }
  }

  enqueueTrace?.({ phase: "heap", label: "Running specialists…" });

  const allHeapToolResults: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
  type RunSpecialist = (specialistId: string, task: string, context: { steps: { specialistId: string; outcome: string }[] }) => Promise<{ summary: string }>;
  const runSpecialistInner: RunSpecialist = async (specialistId, task, context) => {
    const specialist = registry.specialists[specialistId];
    if (!specialist) return { summary: `Unknown specialist: ${specialistId}.` };
    const toolNames = getToolsForSpecialist(registry, specialistId);
    const contextStr = context.steps.length
      ? context.steps.map((s) => `${s.specialistId}: ${s.outcome}`).join("\n")
      : "";
    const specialistMessage = task;
    const priorResults: { name: string; result: unknown }[] = [];
    const execTool = async (name: string, args: Record<string, unknown>) => {
      if (!toolNames.includes(name)) {
        return { error: "Tool not available for this specialist." };
      }
      const resolved = resolveTemplateVars(args, priorResults);
      enqueueTrace?.({ phase: "heap_tool", label: `${specialistId} → ${name}`, specialistId, toolName: name, toolInput: capForTrace(resolved, TRACE_TOOL_PAYLOAD_MAX) });
      const result = await executeTool(name, resolved, executeToolCtx);
      priorResults.push({ name, result });
      enqueueTrace?.({ phase: "heap_tool_done", label: `${specialistId} → ${name}`, specialistId, toolName: name, toolOutput: capForTrace(result, TRACE_TOOL_PAYLOAD_MAX) });
      return result;
    };
    const planSaysCreateAgentWithContext =
      plan &&
      /create\s+(?:an?\s+)?agent/i.test(plan.instructionsForAgent ?? "") &&
      plan.extractedContext &&
      (typeof (plan.extractedContext as Record<string, unknown>).runNow !== "undefined" ||
        (plan.extractedContext as Record<string, unknown>).savedSearchId ||
        (plan.extractedContext as Record<string, unknown>).savedSearchUrl);
    const agentCreateWithDefaultsHint =
      specialistId === "agent" && planSaysCreateAgentWithContext
        ? '\nWhen the plan says to create a new agent and extracted context has runNow or identifiers (e.g. savedSearchId, savedSearchUrl), use the default "Prompt and workflow improvement only" and output create_agent (and list_tools with category improvement, subset prompt_and_topology if needed) in your first response; do not call ask_user for the training option (A/B/C) first.'
        : "";
    const agentCreationBlock =
      specialistId === "agent"
        ? `
CRITICAL — create_agent must produce a runnable agent: Every create_agent call MUST include either (1) systemPrompt (top-level string) or (2) graphNodes with at least one node of type "llm" where parameters.systemPrompt is a concrete, non-empty string. If you only pass name, description, llmConfigId, and toolIds without systemPrompt and without graphNodes, the agent will have an empty graph and will do nothing when a workflow runs it. Minimum runnable example: graphNodes: [{"id": "n1", "type": "llm", "position": [100, 100], "parameters": {"systemPrompt": "<role and behavior in 1–3 sentences>"}}], plus graphEdges if you add tool nodes. Use the agent's description as the basis for the system prompt when the plan does not specify one. Use as much detail in systemPrompt or graphNodes as the agent needs.
${agentCreateWithDefaultsHint}
${AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION}
When creating an agent that requires several user inputs (e.g. content types, run frequency, vault usage, export format): collect them one topic at a time. Call ask_user with the first topic's question and that topic's options only; after the user replies, ask the next topic with its options; repeat until all are answered. Only then call create_agent/create_workflow with the collected inputs and pass them into the agent. Do NOT present all topic titles as one list of options.

Tool cap and multi-agent system design:
- create_agent accepts at most 10 tools per agent (toolIds length ≤ 10). If you pass more, the tool returns TOOL_CAP_EXCEEDED; do not retry with the same list.
- When the user's goal would require more than 10 tools: You must design and create a multi-agent system using agentic/meta-workflow patterns. You only have agent tools; the workflow specialist will create and wire the workflow. (1) Choose a pattern that fits the goal: Pipeline (A→B→C) for sequential steps; Evaluator-optimizer (A↔B with maxRounds) for generate-and-critique; Role-based assembly line (e.g. researcher → writer → reviewer); Orchestrator-workers (one coordinator, multiple workers). (2) Group tools by role (e.g. browser/vault/fetch for collector, improvement tools for improver). (3) Create one agent per role with create_agent (at most 10 toolIds each), report each with "[Created agent id: ...]" and in your summary indicate the pattern (e.g. "Pipeline: Collector → Improver") so the workflow specialist can wire edges and maxRounds.
- When ≤10 tools suffice: Create one agent and report its id; the workflow specialist will create a single-node workflow.
- On TOOL_CAP_EXCEEDED: If a create_agent result has code "TOOL_CAP_EXCEEDED", you MUST retry by designing a multi-agent system using an agentic pattern: create multiple agents (each ≤10 tools, one role per pattern), report each with "[Created agent id: ...]". The workflow specialist will then create and wire the workflow. Do not retry with the same single-agent call.`
        : "";
    const improvementLoopBlock =
      specialistId === "improve_agents_workflows" || specialistId.startsWith("improve_agents_workflows__")
        ? `
Improvement scope: You make persistent changes to workflow agents and workflows only (studio DB). You do not modify the heap or create session-only changes. All update_agent, update_workflow, create_tool calls are persisted.
${IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE} Only use your tools to observe existing runs (get_run_for_improvement, get_feedback_for_scope) and then act (update_agent, update_workflow). If there is no runId or agentId to observe yet, output a brief handoff (e.g. "Creation will be done by agent and workflow specialists.") and no tool calls that ask for creation params.
Do not judge the whole list of tools. Options are structured in the heap. First call get_specialist_options('improve_agents_workflows') to get option groups (observe, act_prompt, act_topology, act_training, evaluate). Judge which group(s) are meaningful for the task; then call tools from those groups only.
Loop: 1) Observe — get_run_for_improvement(runId), get_feedback_for_scope(agentId). 2) Decide — which group(s): act_prompt, act_topology, or act_training. 3) Act — call tools from the chosen group(s). 4) Evaluate — execute_workflow or ask_user("Goal achieved?" ["Done", "Retry"]). Stop when Done or after 2–3 rounds. Use the plan's instructionsForImproveAgentsWorkflows and extractedContext when provided.`
        : "";
    const workflowAgentUuidBlock =
      specialistId === "workflow" || specialistId.startsWith("workflow__")
        ? `
For update_workflow, every agent node must have parameters.agentId set to the agent's UUID (id), never the agent's name. If Previous steps include "[Created agent id: <uuid>]", use that exact uuid for parameters.agentId. Otherwise call list_agents and set parameters.agentId to the matching agent's id.
If Previous steps say an agent was created (e.g. "Created a runnable agent", "created ... agent") but do not include "[Created agent id: ...]", call list_agents and use the matching agent's id (by name or most recent) for parameters.agentId; then create/update the workflow and run if the user asked to run. Do not ask the user for the agent UUID in that case.
Workflow id: For update_workflow, add_workflow_edges, and execute_workflow always pass the workflow by id (UUID). Use the id from create_workflow result in this turn, or from "[Created workflow id: <uuid>]" in Previous steps, or from Studio resources (Workflows: name (id)) when the user asked to run a workflow and exactly one workflow is listed. Pass it as "id" or "workflowId" in the tool arguments — never identify the workflow by name. If the user said "run the workflow" or "run it" and you have one workflow in Studio resources or in Previous steps, use that workflow's id for execute_workflow — do not skip the call for lack of id.
When execute_workflow returns status "failed", always report result.error to the user. On "Agent not found" or missing/invalid agentId: call get_workflow to inspect the workflow, fix parameters.agentId (e.g. from list_agents or from "[Created agent id: ...]" in previous steps), call update_workflow, then offer to re-run.
You may try fixing the problem yourself first (e.g. create the missing agent if the workflow expects one, then update_workflow with the new agent id and re-run execute_workflow). Only if the fix is ambiguous or fails, report the failure and options to the user.`
        : "";
    const choiceBlock =
      toolNames.includes("ask_user")
        ? `
When presenting choices: call ask_user with question and 2–4 options. Output exactly ONE ask_user call per response when you need multiple answers (e.g. config questions): ask the first topic only, wait for the user's reply, then in the next turn ask the next topic. Do not output multiple ask_user calls in one response.
In this chat context you must use ask_user only. Do not use std-request-user-help or "Request user input (workflow pause)" — that tool is for workflow runs, not for chat; here the user replies in the next message.
When asking which workflow or agent to use (run, update, enable, etc.): first call list_workflows or list_agents if needed, then in your message include the concrete names so the user knows what they are choosing (e.g. "Current workflows: **LinkedIn Niche Browsing**, **Extract Config**. Which should I run?"). Never say only "I listed your agents and workflows" without listing the names in the same message.
Prefer acting with sensible defaults when the user's intent is clear from the task or previous steps; use ask_user only when genuinely ambiguous (e.g. multiple options and no clear prior choice).`
        : `
When the previous step is waiting for user input, do not call tools that require user input. Respond with a brief summary of what will happen once the user replies.`;
    const studioContextForSpecialist =
      specialistId === "agent" ? opts.studioContext : opts.studioContext ? { ...opts.studioContext, tools: [] } : undefined;
    const result = await runAssistant([], specialistMessage, {
      callLLM,
      executeTool: execTool,
      systemPromptOverride: `You are the "${specialistId}" specialist. Use only these tools: ${toolNames.join(", ")}. Complete the task and respond with a brief summary.
When the task requires creating, updating, or configuring agents, workflows, or tools, you MUST output <tool_call> blocks in your FIRST response. Use this format: <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>. Do not respond with only a summary or "I will..." — output the actual tool calls immediately so the system can execute them.${choiceBlock}${agentCreationBlock}${improvementLoopBlock}${workflowAgentUuidBlock}`,
      feedbackInjection: opts.feedbackInjection,
      ragContext: opts.ragContext,
      uiContext: opts.uiContext,
      studioContext: studioContextForSpecialist,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens ?? 16384,
    });
    if (result.toolResults.length > 0) {
      for (const tr of result.toolResults) {
        allHeapToolResults.push({ name: tr.name, args: tr.args, result: tr.result });
      }
    }
    const summary = buildSpecialistSummaryWithCreatedIds(result.content ?? "", result.toolResults);
    return { summary };
  };

  const runSpecialist: RunSpecialist = async (specialistId, task, context) => {
    const contextStr = context.steps.length ? context.steps.map((s) => `${s.specialistId}: ${s.outcome}`).join("\n") : "";
    const effectiveTask = plan
      ? enrichTaskWithPlan(refinedTask, specialistId, plan, contextStr)
      : (contextStr ? `${task}\n\nPrevious steps:\n${contextStr}` : task) +
        (opts.recentConversationContext
          ? "\n\nRecent conversation (use for URLs, IDs, and intent):\n" + opts.recentConversationContext
          : "");
    enqueueTrace?.({ phase: "heap_specialist", label: `Specialist ${specialistId}…`, specialistId });
    if (currentSpecialistIdRef) currentSpecialistIdRef.current = specialistId;
    try {
      const result = await runSpecialistInner(specialistId, effectiveTask, context);
      enqueueTrace?.({ phase: "heap_specialist_done", label: `${specialistId}: ${result.summary.slice(0, 80)}${result.summary.length > 80 ? "…" : ""}`, specialistId, contentPreview: result.summary });
      return result;
    } finally {
      if (currentSpecialistIdRef) currentSpecialistIdRef.current = null;
    }
  };

  const heapResult = await runHeap(orderToRun, refinedTask, runSpecialist, registry, {
    traceId,
    log: (msg, data) => {
      if (typeof console !== "undefined" && console.info) {
        console.info(msg, data ?? "");
      }
    },
  });

  return {
    content: heapResult.summary,
    toolResults: allHeapToolResults,
    plan: plan ?? null,
    refinedTask,
    priorityOrder,
    reasoning: undefined,
    todos: undefined,
    completedStepIndices: undefined,
  };
}

export async function POST(request: Request) {
  const payload = await request.json();
  const userMessage = payload.message as string;
  const providerId = payload.providerId as string | undefined;
  const uiContext = typeof payload.uiContext === "string" ? payload.uiContext.trim() : undefined;
  const attachedContext = typeof payload.attachedContext === "string" ? payload.attachedContext.trim() : undefined;
  let conversationId = typeof payload.conversationId === "string" ? payload.conversationId.trim() || undefined : undefined;
  const conversationTitle = typeof payload.conversationTitle === "string" ? payload.conversationTitle.trim() || undefined : undefined;
  const credentialResponse = payload.credentialResponse as { credentialKey?: string; value?: string; save?: boolean } | undefined;
  const isCredentialReply = credentialResponse && typeof credentialResponse.value === "string" && credentialResponse.value.trim() !== "";

  const useHeapMode = payload.useHeapMode === true;

  const continueShellApproval = payload.continueShellApproval as { command?: string; stdout?: string; stderr?: string; exitCode?: number } | undefined;
  const hasContinueShellApproval =
    continueShellApproval != null &&
    typeof continueShellApproval === "object" &&
    typeof (continueShellApproval.command ?? "") === "string" &&
    (continueShellApproval.command ?? "").trim() !== "";

  if (!userMessage && !isCredentialReply && !hasContinueShellApproval) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e31fdf'},body:JSON.stringify({sessionId:'e31fdf',location:'chat/route.ts:400',message:'chat 400 message required',data:{reason:'message required'},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return json({ error: "message required" }, { status: 400 });
  }
  if (hasContinueShellApproval && !conversationId) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e31fdf'},body:JSON.stringify({sessionId:'e31fdf',location:'chat/route.ts:400',message:'chat 400 conversationId required',data:{reason:'conversationId required'},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return json({ error: "conversationId required when using continueShellApproval" }, { status: 400 });
  }

  const vaultKey = getVaultKeyFromRequest(request);
  const contentToStore = isCredentialReply ? "Credentials provided." : hasContinueShellApproval ? "Command approved and run." : (userMessage || "");
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    await db.insert(conversations).values(toConversationRow({
      id: conversationId,
      title: conversationTitle ?? null,
      rating: null,
      note: null,
      summary: null,
      lastUsedProvider: null,
      lastUsedModel: null,
      createdAt: Date.now(),
    })).run();
  }
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"chat/route.ts:POST_received",message:"POST received",data:{conversationId:conversationId ?? null,streamRequested:request.url.includes("stream=1")||request.headers.get("accept")?.includes("text/event-stream"),messageLen:(userMessage||"").length},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (conversationId) await clearActiveBySourceId("chat", conversationId);

  const executeTurn = async (writer?: { enqueue(d: object): void }, turnId?: string) => {
  // #region agent log
  if (typeof fetch !== "undefined") fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e0760a'},body:JSON.stringify({sessionId:'e0760a',location:'chat/route.ts:executeTurn_entry',message:'executeTurn started',data:{hasWriter:writer!=null,hasTurnId:turnId!=null},hypothesisId:'H5',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  // When user submits credentials, save to vault (only when vault is unlocked)
  if (isCredentialReply && credentialResponse?.credentialKey && credentialResponse.save) {
    const key = String(credentialResponse.credentialKey).trim().toLowerCase().replace(/\s+/g, "_") || "credential";
    const plaintext = credentialResponse.value!.trim();
    await setStoredCredential(key, plaintext, true, vaultKey);
  }

  const bypassRunResponse = payload.bypassRunResponse === true;
  const runIdFromClient = typeof payload.runId === "string" ? payload.runId.trim() || undefined : undefined;
  let didAutoForwardToRun = false;
  let forwardedRunId: string | null = null;

  // Option 3: when a run is waiting for user input (or a run is executing), inject run context so the Chat assistant
  // can respond to the right run and does not confuse multiple runs (e.g. one finished, one running).
  let runWaitingContext: string | undefined;
  if (!bypassRunResponse && !isCredentialReply && conversationId) {
    let waitingRows = await db
      .select({ id: executions.id, targetId: executions.targetId, output: executions.output })
      .from(executions)
      .where(and(eq(executions.status, "waiting_for_user"), eq(executions.conversationId, conversationId)))
      .orderBy(desc(executions.startedAt))
      .limit(1);
    // Runs started from the Run page have conversationId = null; allow replying via Chat when client sends runId (e.g. from "Reply in Chat" link).
    if (waitingRows.length === 0 && runIdFromClient) {
      const byRunId = await db
        .select({ id: executions.id, targetId: executions.targetId, output: executions.output })
        .from(executions)
        .where(eq(executions.id, runIdFromClient))
        .limit(1);
      if (byRunId.length > 0 && byRunId[0].id === runIdFromClient) {
        const runRow = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, runIdFromClient)).limit(1);
        if (runRow[0]?.status === "waiting_for_user") {
          waitingRows = byRunId;
          await db.update(executions).set({ conversationId }).where(eq(executions.id, runIdFromClient)).run();
        }
      }
    }
    // Also fetch the most recent running run for this conversation so the assistant knows about it when one run finished and another is running.
    const runningRows = await db
      .select({ id: executions.id, targetId: executions.targetId })
      .from(executions)
      .where(and(eq(executions.status, "running"), eq(executions.conversationId, conversationId)))
      .orderBy(desc(executions.startedAt))
      .limit(1);
    const runningRunId = runningRows.length > 0 ? runningRows[0].id : undefined;
    const waitingRunId = waitingRows.length > 0 ? waitingRows[0].id : undefined;
    const runningLine = runningRunId
      ? `**Run currently executing** (use get_run(id: "${runningRunId}") to check status): runId ${runningRunId}. Do not say the run cannot be found.`
      : undefined;
    if (waitingRows.length === 0 && runningLine) {
      runWaitingContext = runningLine;
      runWaitingContext += "\n**Rule:** When referring to this run, use runId " + runningRunId + ".";
    }
    if (waitingRows.length > 0) {
      const runId = waitingRows[0].id;
      let current: Record<string, unknown> | undefined;
      try {
        const raw = waitingRows[0].output;
        current = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw != null ? (raw as Record<string, unknown>) : undefined);
      } catch {
        current = undefined;
      }
      // Run output can be: (1) flat { question, message, suggestions } from request_user_help, or
      // (2) wrapped { output: {...}, trail: [...] } from executionOutputSuccess
      const inner = current && typeof current.output === "object" && current.output !== null
        ? (current.output as Record<string, unknown>)
        : current;
      let question: string | undefined;
      if (typeof current?.question === "string" && current.question.trim()) {
        question = current.question.trim();
      } else if (typeof current?.message === "string" && current.message.trim()) {
        question = current.message.trim();
      } else if (inner && typeof inner.question === "string" && inner.question.trim()) {
        question = inner.question.trim();
      } else if (inner && typeof inner.message === "string" && inner.message.trim()) {
        question = inner.message.trim();
      }
      const suggestions = Array.isArray(inner?.suggestions) ? inner.suggestions : undefined;
      const opts = Array.isArray(inner?.options) ? inner.options : suggestions;
      const optionsList = opts?.map((o) => String(o)).filter(Boolean) ?? [];
      const parts: string[] = [
        `**Run waiting for your reply** (use this runId for respond_to_run): ${runId}`,
        `targetId: ${waitingRows[0].targetId ?? "unknown"}`,
        question ? `question: ${question}` : "",
        optionsList.length > 0 ? `options: ${optionsList.join(", ")}` : "",
      ].filter(Boolean);
      parts.push("raw output (JSON): " + JSON.stringify(inner ?? current ?? {}));
      runWaitingContext = parts.join("\n");
      if (runningLine && runningRunId !== waitingRunId) {
        runWaitingContext += "\n" + runningLine;
        runWaitingContext += "\n**Rule:** There are two runs (one waiting for input, one executing). Always be clear which run you refer to. If the user's message does not clearly refer to one run, ask: \"Do you mean the run waiting for your input, or the one that's still executing?\"";
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat/route.ts:runWaitingContext',message:'run waiting context set for chat',data:{runId,conversationId},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // Auto-forward user's Chat message to the waiting run so the workflow receives it without requiring the assistant to call respond_to_run
      const replyText = (userMessage ?? "").trim();
      if (!bypassRunResponse && !isCredentialReply && replyText !== "") {
        const runRows = await db.select().from(executions).where(eq(executions.id, runId));
        if (runRows.length > 0 && runRows[0].status === "waiting_for_user") {
          const run = runRows[0];
          const response = replyText || "(no text)";
          const current = (() => {
            try {
              const raw = run.output;
              return typeof raw === "string" ? JSON.parse(raw) : raw;
            } catch {
              return undefined;
            }
          })();
          const existingOutput = current && typeof current === "object" && !Array.isArray(current) && current.output !== undefined ? current.output : undefined;
          const existingTrail = Array.isArray(current?.trail) ? current.trail : [];
          const mergedOutput = {
            ...(existingOutput && typeof existingOutput === "object" && !Array.isArray(existingOutput) ? existingOutput : {}),
            userResponded: true,
            response,
          };
          const outPayload = executionOutputSuccess(mergedOutput, existingTrail.length > 0 ? existingTrail : undefined);
          await db
            .update(executions)
            .set({ status: "running", finishedAt: null, output: JSON.stringify(outPayload) })
            .where(eq(executions.id, runId))
            .run();
          const replyPreview = response.length > 80 ? response.slice(0, 77) + "…" : response;
          await db.insert(runLogs).values({
            id: crypto.randomUUID(),
            executionId: runId,
            level: "stdout",
            message: `User replied (Chat): ${replyPreview}`,
            payload: null,
            createdAt: Date.now(),
          }).run();
          enqueueWorkflowResume({ runId, resumeUserResponse: response });
          didAutoForwardToRun = true;
          forwardedRunId = runId;
          void processOneWorkflowJob().catch(() => {});
        }
      }
    }
  }

  // Use server-side history when we have an existing conversation so context is reliable (single source of truth, works across tabs).
  const MAX_HISTORY_MESSAGES = 50;
  let history = (payload.history ?? []) as LLMMessage[];
  const existingRows = await db
    .select({ role: chatMessages.role, content: chatMessages.content, toolCalls: chatMessages.toolCalls })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
  if (existingRows.length > 0) {
    const trimmed = existingRows.length > MAX_HISTORY_MESSAGES ? existingRows.slice(-MAX_HISTORY_MESSAGES) : existingRows;
    history = trimmed.map((r) => {
      const role = r.role as "user" | "assistant" | "system";
      let content = r.content ?? "";
      // When assistant message has no content (e.g. only tool calls), use ask_user question from toolCalls so the next turn retains context (e.g. "3" → option 3).
      if (role === "assistant" && !content.trim()) {
        const parsed = (() => {
          try {
            return typeof r.toolCalls === "string" ? (JSON.parse(r.toolCalls) as { name: string; result?: unknown }[]) : undefined;
          } catch {
            return undefined;
          }
        })();
        const question = getAskUserQuestionFromToolResults(parsed);
        if (question) content = question;
      }
      return { role, content };
    });
  }

  // When the user confirms the first option of an ask_user that listed agents/workflows to delete,
  // run deletions server-side and inject a single follow-up message so the LLM only does creation (saves LLM calls).
  let confirmationPathMessage: string | null = null;
  if (
    !isCredentialReply &&
    !hasContinueShellApproval &&
    conversationId &&
    (userMessage ?? contentToStore ?? "").trim()
  ) {
    const lastRow = existingRows.length > 0 ? existingRows[existingRows.length - 1] : undefined;
    const ctx = getLastAssistantDeleteConfirmContext(lastRow);
    if (ctx) {
      const userTrim = (userMessage ?? contentToStore ?? "").trim();
      if (userMessageMatchesFirstOption(userTrim, ctx.firstOption)) {
        for (const id of ctx.agentIds) {
          await executeTool("delete_agent", { id }, { conversationId, vaultKey });
        }
        for (const id of ctx.workflowIds) {
          await executeTool("delete_workflow", { id }, { conversationId, vaultKey });
        }
        confirmationPathMessage = `The user confirmed: "${userTrim}". I have already deleted all listed agents and workflows. Deleted agent ids: ${ctx.agentIds.join(", ")}. Deleted workflow ids: ${ctx.workflowIds.join(", ")}. Now create the new container-backed agent and workflow as you planned: use std-container-run for the agent, create the workflow, update_workflow to wire the agent to the workflow, then offer to run it.`;
      }
    }
  }

  const configRows = await db.select().from(llmConfigs);
  if (configRows.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e31fdf'},body:JSON.stringify({sessionId:'e31fdf',location:'chat/route.ts:400',message:'chat 400 no LLM configured',data:{reason:'no LLM'},hypothesisId:'H1_H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return json({ error: "No LLM provider configured. Go to LLM Settings to add one." }, { status: 400 });
  }
  const configsWithSecret = configRows.map(fromLlmConfigRowWithSecret);
  let llmConfig: (typeof configsWithSecret)[0] | undefined;
  if (providerId) {
    llmConfig = configsWithSecret.find((c) => c.id === providerId);
    if (!llmConfig) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e31fdf'},body:JSON.stringify({sessionId:'e31fdf',location:'chat/route.ts:400',message:'chat 400 provider not found',data:{providerId},hypothesisId:'H5',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return json({ error: "Selected provider not found or was removed." }, { status: 400 });
    }
  } else {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e31fdf'},body:JSON.stringify({sessionId:'e31fdf',location:'chat/route.ts:400',message:'chat 400 no provider selected',data:{reason:'no providerId'},hypothesisId:'H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return json(
      { error: "Please select an LLM provider from the dropdown." },
      { status: 400 }
    );
  }
  const manager = createDefaultLLMManager(async (ref) => ref ? process.env[ref] : undefined);

  // Studio RAG: resolve deployment collection and retrieve context for user message
  const studioCollectionId = await getDeploymentCollectionId();
  const ragChunks = studioCollectionId
    ? await retrieveChunks(studioCollectionId, userMessage, 5)
    : [];
  const ragContext = ragChunks.length > 0 ? ragChunks.map((c) => c.text).join("\n\n") : undefined;

  // Load chat feedback for injection
  const fbRows = await db.select().from(feedback).where(eq(feedback.targetType, "chat"));
  const feedbackItems = fbRows.map(fromFeedbackRow);
  const feedbackInjection = buildFeedbackInjection(feedbackItems.slice(-10));

  // Load chat assistant settings (custom prompt, context selection, recent summaries count, history compression). Fallback to null if table missing.
  let chatSettings: { customSystemPrompt: string | null; contextAgentIds: string[] | null; contextWorkflowIds: string[] | null; contextToolIds: string[] | null; recentSummariesCount: number | null; temperature: number | null; historyCompressAfter: number | null; historyKeepRecent: number | null; plannerRecentMessages: number | null } | null = null;
  try {
    const settingsRows = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, "default"));
    chatSettings = settingsRows.length > 0 ? fromChatAssistantSettingsRow(settingsRows[0]) : null;
  } catch {
    // Table may not exist yet (e.g. new deployment without migration)
  }
  const systemPromptOverride = chatSettings?.customSystemPrompt && chatSettings.customSystemPrompt.trim().length > 0
    ? chatSettings.customSystemPrompt.trim()
    : undefined;

  const chatTemperature = chatSettings?.temperature ?? 0.7;

  const recentSummariesCount = Math.min(MAX_SUMMARIES, Math.max(MIN_SUMMARIES, chatSettings?.recentSummariesCount ?? DEFAULT_RECENT_SUMMARIES_COUNT));

  // Cross-chat context: stored preferences + recent conversation summaries
  let crossChatContext = "";
  try {
    const memoryRows = await db.select().from(assistantMemory).orderBy(asc(assistantMemory.createdAt));
    if (memoryRows.length > 0) {
      const prefs = memoryRows.map((r) => fromAssistantMemoryRow(r)).map((e) => (e.key ? `${e.key}: ${e.content}` : e.content)).join("\n");
      crossChatContext += `Stored preferences (use these when relevant):\n${prefs}\n\n`;
    }
  } catch {
    // assistant_memory table may not exist yet
  }
  try {
    const convsWithSummary = await db
      .select({ id: conversations.id, title: conversations.title, summary: conversations.summary })
      .from(conversations)
      .where(isNotNull(conversations.summary))
      .orderBy(desc(conversations.createdAt))
      .limit(recentSummariesCount);
    if (convsWithSummary.length > 0) {
      crossChatContext += "Recent conversation summaries and last output (user may reference 'the output' or 'what you said last time'):\n";
      for (const c of convsWithSummary) {
        const title = (c.title && c.title.trim()) || "Chat";
        crossChatContext += `- ${title}: ${(c.summary as string).trim()}\n`;
        const lastRows = await db
          .select({ role: chatMessages.role, content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, c.id))
          .orderBy(desc(chatMessages.createdAt))
          .limit(LAST_MESSAGES_PER_RECENT_CHAT);
        const chronological = lastRows.reverse();
        if (chronological.length > 0) {
          const tail = chronological.map((r) => `${r.role}: ${r.content.slice(0, 600)}${r.content.length > 600 ? "…" : ""}`).join("\n  ");
          crossChatContext += `  Last messages:\n  ${tail}\n`;
        }
      }
    }
  } catch {
    // summary column may not exist yet
  }
  const crossChatContextTrimmed = crossChatContext.trim() || undefined;

  // Load studio context so the assistant knows available tools, agents, workflows, LLM providers
  await ensureStandardTools();
  const [agentRows, workflowRows, toolRows, llmRows] = await Promise.all([
    db.select().from(agents),
    db.select().from(workflows),
    db.select().from(tools),
    db.select().from(llmConfigs),
  ]);
  const agentIds = chatSettings?.contextAgentIds;
  const workflowIds = chatSettings?.contextWorkflowIds;
  const toolIdsFilter = chatSettings?.contextToolIds;
  const safeToolRows = Array.isArray(toolRows) ? toolRows : [];
  const safeAgentRows = Array.isArray(agentRows) ? agentRows : [];
  const safeWorkflowRows = Array.isArray(workflowRows) ? workflowRows : [];
  const safeLlmRows = Array.isArray(llmRows) ? llmRows : [];
  const studioContext: StudioContext = {
    tools: (toolIdsFilter == null || toolIdsFilter.length === 0
      ? safeToolRows.map(fromToolRow)
      : safeToolRows.map(fromToolRow).filter((t) => toolIdsFilter.includes(t.id))
    ).map((t) => ({ id: t.id, name: t.name, protocol: t.protocol })),
    agents: (agentIds == null || agentIds.length === 0
      ? safeAgentRows.map(fromAgentRow)
      : safeAgentRows.map(fromAgentRow).filter((a) => agentIds.includes(a.id))
    ).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    workflows: (workflowIds == null || workflowIds.length === 0
      ? safeWorkflowRows.map(fromWorkflowRow)
      : safeWorkflowRows.map(fromWorkflowRow).filter((w) => workflowIds.includes(w.id))
    ).map((w) => ({ id: w.id, name: w.name, executionMode: w.executionMode })),
    llmProviders: safeLlmRows.map(fromLlmConfigRow).map((c) => ({ id: c.id, provider: c.provider, model: c.model })),
  };

  // Load custom pricing overrides
  const pricingRows = await db.select().from(modelPricing);
  const customPricing: Record<string, { input: number; output: number }> = {};
  for (const r of pricingRows) {
    const p = fromModelPricingRow(r);
    customPricing[p.modelPattern] = { input: Number(p.inputCostPerM), output: Number(p.outputCostPerM) };
  }

  // Track token usage across all LLM calls in this request
  const usageEntries: { response: LLMResponse }[] = [];

  const STOPPED_BY_USER = "Stopped by user";

  /** Build a callLLM wrapper that records usage and optionally records trace + streams trace_step events. Respects request signal so the agent stops when the user clicks Stop. */
  const LLM_TRACE_PREVIEW_MAX = 600;
  function createTrackingCallLLM(opts: {
    pushTrace?: (entry: LLMTraceCall) => void;
    enqueueTraceStep?: (step: {
      phase: string;
      label?: string;
      messageCount?: number;
      contentPreview?: string;
      inputPreview?: string;
      /** Full messages sent to the LLM (for queue log / debugging). */
      requestMessages?: Array<{ role: string; content: string }>;
      /** Full response content from the LLM (for queue log / debugging). */
      responseContent?: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      specialistId?: string;
    }) => void;
    signal?: AbortSignal | null;
    /** When provided (e.g. heap mode), merged into every enqueued trace step so LLM steps show which specialist triggered them. */
    getExtraTraceData?: () => { specialistId?: string };
  }) {
    return async (req: Parameters<typeof manager.chat>[1]) => {
      if (opts.signal?.aborted) throw new Error(STOPPED_BY_USER);
      const extra = opts.getExtraTraceData?.() ?? {};
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
      const inputPreview = typeof lastUser?.content === "string"
        ? lastUser.content.trim().slice(0, LLM_TRACE_PREVIEW_MAX)
        : req.messages.length > 0
          ? `[${req.messages.length} messages]`
          : undefined;
      const requestMessagesForLog = req.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
      }));
      opts.enqueueTraceStep?.({
        phase: "llm_request",
        label: "Calling LLM…",
        messageCount: req.messages.length,
        inputPreview,
        requestMessages: requestMessagesForLog,
        ...extra,
      });
      const response = await manager.chat(llmConfig as LLMConfig, req, { source: "chat" });
      usageEntries.push({ response });
      const contentStr = typeof response.content === "string" ? response.content : "";
      const outputPreview = contentStr.slice(0, LLM_TRACE_PREVIEW_MAX);
      opts.pushTrace?.({
        messageCount: req.messages.length,
        lastUserContent: typeof lastUser?.content === "string" ? lastUser.content.slice(0, 500) : undefined,
        requestMessages: req.messages.slice(-6).map((m) => ({
          role: m.role,
          content: (typeof m.content === "string" ? m.content : "").slice(0, 800),
        })),
        responseContent: contentStr.slice(0, 12000),
        responsePreview: contentStr.slice(0, 400),
        usage: response.usage,
      });
      opts.enqueueTraceStep?.({
        phase: "llm_response",
        label: "Response received",
        contentPreview: outputPreview,
        responseContent: contentStr,
        usage: response.usage,
        ...extra,
      });
      return response;
    };
  }

  // Compress long history so the agent keeps context without exceeding token limits (thresholds from settings)
  const historyCompressAfter = Math.max(10, Math.min(200, chatSettings?.historyCompressAfter ?? DEFAULT_HISTORY_COMPRESS_AFTER));
  const historyKeepRecent = Math.max(5, Math.min(100, chatSettings?.historyKeepRecent ?? DEFAULT_HISTORY_KEEP_RECENT));
  const effectiveKeepRecent = Math.min(historyKeepRecent, historyCompressAfter - 1);
  if (history.length > historyCompressAfter) {
    try {
      const toSummarize = history.slice(0, history.length - effectiveKeepRecent);
      const summary = await summarizeHistoryChunk(
        toSummarize.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
        manager,
        llmConfig
      );
      history = [
        { role: "system" as const, content: `Earlier in this conversation (summarized):\n${summary}` },
        ...history.slice(-effectiveKeepRecent),
      ];
    } catch {
      // If summarization fails, just trim to last N so we don't blow context
      history = history.slice(-effectiveKeepRecent);
    }
  }

  if (writer != null && turnId != null) {
    const signal = request.signal;
    const throwIfAborted = () => {
      if (signal?.aborted) throw new Error(STOPPED_BY_USER);
    };
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: contentToStore, createdAt: Date.now(), conversationId: conversationId! };
    let generatedTitle: string | null = null;
    const llmTraceEntries: LLMTraceCall[] = [];
    let rephraseTraceEntry: LLMTraceCall | null = null;
    const enqueue = writer.enqueue;
    const currentSpecialistIdRef = { current: null as string | null };
        const streamTrackingCallLLM = createTrackingCallLLM({
          pushTrace: (e) => llmTraceEntries.push(e),
          enqueueTraceStep: (step) => enqueue({ type: "trace_step", ...step }),
          signal,
          getExtraTraceData: useHeapMode ? () => ({ specialistId: currentSpecialistIdRef.current ?? undefined }) : undefined,
        });
        let doneSent = false;
        try {
          await db.insert(chatMessages).values(toChatMessageRow(userMsg)).run();
          throwIfAborted();

          if (didAutoForwardToRun && forwardedRunId) {
            const shortContent = `I've sent your reply to the run. The workflow is continuing. [View run](/runs/${forwardedRunId}).`;
            const assistantMsgShort = {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: shortContent,
              createdAt: Date.now(),
              conversationId: conversationId!,
            };
            doneSent = true;
            enqueue(
              sanitizeDonePayload({
                type: "done",
                content: shortContent,
                messageId: assistantMsgShort.id,
                userMessageId: userMsg.id,
                conversationId,
              })
            );
            await db.insert(chatMessages).values(toChatMessageRow(assistantMsgShort)).run();
            return;
          }

          const userInputPreview = (userMessage ?? contentToStore ?? "").trim().slice(0, 500);
          if (userInputPreview) {
            enqueue({ type: "trace_step", phase: "user_input", label: "User input", inputPreview: userInputPreview });
          }

          if (existingRows.length === 0 && !isCredentialReply) {
            enqueue({ type: "trace_step", phase: "title", label: "Generating title…" });
            generatedTitle = await generateConversationTitle((userMessage || contentToStore).trim().slice(0, 2000), manager, llmConfig);
            await db.update(conversations).set({ ...(generatedTitle && { title: generatedTitle }) }).where(eq(conversations.id, conversationId!)).run();
            enqueue({ type: "trace_step", phase: "title_done", label: "Title set" });
          }
          throwIfAborted();

          // High-level context preparation step (history, feedback, knowledge, studio resources)
          enqueue({ type: "trace_step", phase: "prepare", label: "Preparing context (history, knowledge, tools)…" });
          throwIfAborted();

          let effectiveMessage: string;
          let rephrasedPrompt: string | undefined;
          if (isCredentialReply && credentialResponse?.value) {
            effectiveMessage = credentialResponse.value.trim();
            rephrasedPrompt = undefined;
            enqueue({ type: "trace_step", phase: "rephrase_done", label: "Using provided credential" });
          } else if (hasContinueShellApproval && continueShellApproval) {
            effectiveMessage = buildContinueShellApprovalMessage({ ...continueShellApproval, command: continueShellApproval.command ?? "" });
            rephrasedPrompt = undefined;
            enqueue({ type: "trace_step", phase: "rephrase_done", label: "Continue from shell approval" });
          } else if (confirmationPathMessage) {
            effectiveMessage = confirmationPathMessage;
            rephrasedPrompt = undefined;
            enqueue({ type: "trace_step", phase: "rephrase_done", label: "Deletions done, continuing" });
          } else if (shouldSkipRephrase(contentToStore, payload)) {
            effectiveMessage = (userMessage || contentToStore).trim().slice(0, 2000);
            rephrasedPrompt = undefined;
            enqueue({ type: "trace_step", phase: "rephrase_done", label: "Rephrase skipped" });
          } else {
            enqueue({ type: "trace_step", phase: "rephrase", label: "Rephrasing…" });
            const rephraseResult = await rephraseAndClassify(userMessage || contentToStore, manager, llmConfig, { onLlmCall: (e) => { rephraseTraceEntry = e; } });
            throwIfAborted();
            enqueue({ type: "trace_step", phase: "rephrase_done", label: "Rephrase done" });
            rephrasedPrompt = rephraseResult.rephrasedPrompt;
            if (rephrasedPrompt != null) {
              enqueue({ type: "rephrased_prompt", rephrasedPrompt, label: "Rephrased prompt" });
            }
            const trimmed = (userMessage || contentToStore).trim().slice(0, 2000);
            effectiveMessage = rephrasedPrompt ?? trimmed;
            if (rephraseResult.wantsRetry) {
              const allRows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId!)).orderBy(asc(chatMessages.createdAt));
              const lastUserMsg = [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
              if (lastUserMsg) effectiveMessage = lastUserMsg;
            }
          }
          throwIfAborted();

          const pendingPlan = conversationId ? pendingPlanByConversation.get(conversationId) : undefined;
          const result = useHeapMode
            ? await runHeapModeTurn({
                effectiveMessage,
                callLLM: streamTrackingCallLLM,
                executeToolCtx: { conversationId, vaultKey, registry: getRegistry(loadSpecialistOverrides()) },
                registry: getRegistry(loadSpecialistOverrides()),
                manager,
                llmConfig,
                pushUsage: (r) => usageEntries.push({ response: r }),
                enqueueTrace: (step) => enqueue({ type: "trace_step", ...step }),
                currentSpecialistIdRef,
                recentConversationContext: buildRecentConversationContext(history, chatSettings?.plannerRecentMessages ?? 12, {
                  appendCurrentMessage: effectiveMessage,
                }),
                runWaitingContext: runWaitingContext,
                pendingPlan: pendingPlan ?? undefined,
                feedbackInjection: feedbackInjection || undefined,
                ragContext,
                uiContext: [uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
                studioContext,
                systemPromptOverride,
                temperature: chatTemperature,
                maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
              })
            : await runAssistant(history, effectiveMessage, {
                callLLM: streamTrackingCallLLM,
                executeTool: (toolName: string, toolArgs: Record<string, unknown>) => executeTool(toolName, toolArgs, { conversationId, vaultKey }),
                feedbackInjection: feedbackInjection || undefined,
                ragContext,
                uiContext: [uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
                attachedContext: attachedContext || undefined,
                studioContext,
                crossChatContext: crossChatContextTrimmed,
                runWaitingContext: runWaitingContext,
                chatSelectedLlm: llmConfig ? { id: llmConfig.id, provider: llmConfig.provider, model: llmConfig.model } : undefined,
                systemPromptOverride,
                temperature: chatTemperature,
                maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
                onProgress: {
                  onPlan(reasoning, todos) {
                    enqueue({ type: "plan", reasoning, todos });
                  },
                  onStepStart(stepIndex, todoLabel, toolName, subStepLabel) {
                    enqueue({ type: "step_start", stepIndex, todoLabel, toolName, ...(subStepLabel != null && { subStepLabel }) });
                  },
                  onToolDone(index) {
                    enqueue({ type: "todo_done", index });
                  },
                },
              });

          // Update pending plan store for heap: store plan when turn ends with ask_user, clear otherwise. Merge created workflow/agent ids into extractedContext so next message (e.g. "Run it now") has them.
          if (useHeapMode && conversationId) {
            if (hasWaitingForInputInToolResults(result.toolResults) && "plan" in result && result.plan) {
              const planToStore = mergeCreatedIdsIntoPlan(result.plan as PlannerOutput, result.toolResults) as PlannerOutput;
              pendingPlanByConversation.set(conversationId, planToStore);
            } else {
              pendingPlanByConversation.delete(conversationId);
            }
          }

          // Heap often presents options in prose only; inject synthetic ask_user so frontend can show clickables. Skip when format_response already present (agent chose to present a questionnaire).
          let toolResultsToUse = result.toolResults;
          const hasAskUser = toolResultsToUse.some((r) => r.name === "ask_user" || r.name === "ask_credentials");
          const hasFormatResponse = hasFormatResponseWithContent(toolResultsToUse);
          if (useHeapMode && !hasAskUser && !hasFormatResponse && manager && llmConfig && (result.content ?? "").trim().length > 0) {
            const callLLMForOptions = async (prompt: string) => {
              const res = await manager.chat(llmConfig as LLMConfig, { messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 512 });
              return res.content ?? "";
            };
            const extracted = await extractOptionsFromContentWithLLM(result.content, callLLMForOptions);
            if (extracted && extracted.length >= 1) {
              // #region agent log
              fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e0760a" }, body: JSON.stringify({ sessionId: "e0760a", location: "chat/route.ts:heap-inject-ask_user", message: "Heap: injected synthetic ask_user", data: { optionCount: extracted.length, options: extracted.slice(0, 8) }, timestamp: Date.now(), hypothesisId: "H1" }) }).catch(() => {});
              // #endregion
              toolResultsToUse = [
                ...toolResultsToUse,
                { name: "ask_user", args: {} as Record<string, unknown>, result: { question: "Please pick an option", options: extracted } },
              ];
            }
          }
          // Normalize ask_user options via strict LLM format so frontend can parse reliably
          if (toolResultsToUse.length > 0 && manager && llmConfig) {
            toolResultsToUse = await normalizeAskUserOptionsInToolResults(toolResultsToUse, async (prompt) => {
              const res = await manager.chat(llmConfig as LLMConfig, { messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 512 });
              return res.content ?? "";
            });
          }

          // Heap multi-specialist: when display content has "Next steps" but ask_user is for a different question (e.g. Q1), derive interactivePrompt from content via strict LLM and override
          const displayContentForOverride = getAssistantDisplayContent(result.content, toolResultsToUse);
          if (useHeapMode && displayContentForOverride.length > 400 && manager && llmConfig) {
            const firstAskUser = toolResultsToUse.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
            if (firstAskUser?.result && typeof firstAskUser.result === "object") {
              const q = String((firstAskUser.result as { question?: string }).question ?? "").trim();
              const contentHasNextSteps = /\bnext steps?|pick one|choose one\b/i.test(displayContentForOverride);
              if (q && !/next steps?|pick one|choose one/i.test(q) && contentHasNextSteps) {
                const callLLMForDerive = async (prompt: string) => {
                  const res = await manager.chat(llmConfig as LLMConfig, { messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 512 });
                  return res.content ?? "";
                };
                const derived = await deriveInteractivePromptFromContentWithLLM(displayContentForOverride, callLLMForDerive);
                if (derived) {
                  toolResultsToUse = toolResultsToUse.map((r) =>
                    (r.name === "ask_user" || r.name === "ask_credentials") && r === firstAskUser
                      ? { ...r, result: { ...(r.result as object), waitingForUser: true, question: derived.question, options: derived.options } }
                      : r
                  );
                }
              }
            }
          }

          const planToolCall = (result.reasoning || (result.todos && result.todos.length > 0))
            ? {
                id: crypto.randomUUID(),
                name: "__plan__",
                arguments: {
                  ...(result.reasoning ? { reasoning: result.reasoning } : {}),
                  ...(result.todos ? { todos: result.todos } : {}),
                  ...(result.completedStepIndices ? { completedStepIndices: result.completedStepIndices } : {}),
                },
              }
            : undefined;
          const enrichedToolResults = await Promise.all(
            toolResultsToUse.map(async (r) => {
              let res = r.result;
              if (r.name === "get_agent" || r.name === "create_agent" || r.name === "update_agent") {
                res = await enrichAgentToolResult(r.result, r.args);
              }
              return { id: crypto.randomUUID(), name: r.name, arguments: r.args, result: res };
            })
          );
          const assistantToolCalls =
            toolResultsToUse.length > 0 || planToolCall
              ? [...enrichedToolResults, ...(planToolCall ? [planToolCall] : [])]
              : undefined;
          const fullLlmTrace = rephraseTraceEntry ? [rephraseTraceEntry, ...llmTraceEntries] : llmTraceEntries;
          let displayContent = getAssistantDisplayContent(result.content, toolResultsToUse);
          const turnStatus = getTurnStatusFromToolResults(toolResultsToUse, useHeapMode ? { useLastAskUser: true } : undefined);
          if (useHeapMode) {
            const lastAskUser = [...toolResultsToUse].reverse().find((r) => r.name === "ask_user" || r.name === "ask_credentials");
            const opts = lastAskUser?.result && typeof lastAskUser.result === "object" && Array.isArray((lastAskUser.result as { options?: unknown }).options)
              ? (lastAskUser.result as { options: unknown[] }).options.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              : [];
            if (opts.length > 0) {
              displayContent = normalizeOptionCountInContent(displayContent, opts.length);
            }
          }
          // Ensure heap (and other) replies are never shown as empty when we have content (e.g. heapResult.summary).
          const fallbackContent = (result.content ?? "").trim();
          if (!displayContent && fallbackContent) displayContent = fallbackContent;
          const assistantMsg = {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: displayContent || getAskUserQuestionFromToolResults(toolResultsToUse) || "",
            toolCalls: assistantToolCalls,
            llmTrace: fullLlmTrace.length > 0 ? fullLlmTrace : undefined,
            ...(rephrasedPrompt != null && rephrasedPrompt.trim() && { rephrasedPrompt }),
            createdAt: Date.now(),
            conversationId,
          };

          // Persist before sending done so any client fetch (e.g. onRunFinished) already sees the reply.
          try {
            await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
            if (conversationId && hasWaitingForInputInToolResults(toolResultsToUse)) {
              await createChatNotification(conversationId);
            }
          } catch (insertErr: unknown) {
            const insertMsg = normalizeChatError(insertErr, llmConfig ? { provider: llmConfig.provider, model: llmConfig.model, endpoint: llmConfig.endpoint } : undefined);
            enqueue({ type: "error", error: insertMsg, errorCode: "CHAT_PERSIST_ERROR", messageId: assistantMsg.id, userMessageId: userMsg.id });
            throw insertErr;
          }

          // Send done after insert so the client can update the UI and any subsequent GET already has the message.
          doneSent = true;
          enqueue(
            sanitizeDonePayload({
              type: "done",
              content: displayContent,
              toolResults: toolResultsToUse,
              status: turnStatus.status,
              ...(turnStatus.interactivePrompt && { interactivePrompt: turnStatus.interactivePrompt }),
              messageId: assistantMsg.id,
              userMessageId: userMsg.id,
              conversationId,
              reasoning: result.reasoning,
              todos: result.todos,
              completedStepIndices: result.completedStepIndices,
              rephrasedPrompt,
              ...(generatedTitle && { conversationTitle: generatedTitle }),
              ...(useHeapMode &&
                "refinedTask" in result &&
                "priorityOrder" in result && {
                  planSummary: {
                    refinedTask: result.refinedTask as string,
                    route: result.priorityOrder as (string | { parallel: string[] })[],
                  },
                }),
            })
          );

          // Post-processing after client has received the response (do not send error if these fail)
          const msgCount = existingRows.length + 2;
          const convRows = await db.select({ summary: conversations.summary }).from(conversations).where(eq(conversations.id, conversationId!));
          if (msgCount >= 6 && convRows.length > 0 && (convRows[0].summary == null || convRows[0].summary === "")) {
            summarizeConversation(conversationId!, manager, llmConfig).catch(() => {});
          }
          for (const entry of usageEntries) {
            const usage = entry.response.usage;
            if (usage && usage.totalTokens > 0) {
              const pricing = resolveModelPricing(llmConfig.model, customPricing);
              const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
              await db.insert(tokenUsage).values(toTokenUsageRow({
                id: crypto.randomUUID(),
                provider: llmConfig.provider,
                model: llmConfig.model,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                estimatedCost: cost != null ? String(cost) : null,
              })).run();
            }
          }
          await db.update(conversations).set({
            lastUsedProvider: llmConfig.provider,
            lastUsedModel: llmConfig.model,
          }).where(eq(conversations.id, conversationId!)).run();
        } catch (err: unknown) {
          const msg = normalizeChatError(err, llmConfig ? { provider: llmConfig.provider, model: llmConfig.model, endpoint: llmConfig.endpoint } : undefined);
          // Do not send error event if we already sent done — the client has the response; overwriting with error would be wrong.
          if (!doneSent) {
            const errorCode = "CHAT_TURN_ERROR";
            try {
              const assistantErrorMsg = {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: `Error: ${msg}`,
                createdAt: Date.now(),
                conversationId,
              };
              await db.insert(chatMessages).values(toChatMessageRow(assistantErrorMsg)).run();
              enqueue({ type: "error", error: msg, errorCode, messageId: assistantErrorMsg.id, userMessageId: userMsg.id });
            } catch (persistErr) {
              enqueue({ type: "error", error: msg, errorCode: "CHAT_PERSIST_ERROR" });
            }
          }
        } finally {
          channelFinish(turnId);
        }
    return;
  }

  if (didAutoForwardToRun && forwardedRunId && conversationId) {
    const userMsgNonStream = { id: crypto.randomUUID(), role: "user" as const, content: contentToStore, createdAt: Date.now(), conversationId };
    await db.insert(chatMessages).values(toChatMessageRow(userMsgNonStream)).run();
    const shortContent = `I've sent your reply to the run. The workflow is continuing. [View run](/runs/${forwardedRunId}).`;
    const assistantMsgShort = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: shortContent,
      createdAt: Date.now(),
      conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsgShort)).run();
    return json({
      content: shortContent,
      messageId: assistantMsgShort.id,
      userMessageId: userMsgNonStream.id,
      conversationId,
    });
  }

  const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: contentToStore, createdAt: Date.now(), conversationId: conversationId! };
  await db.insert(chatMessages).values(toChatMessageRow(userMsg)).run();

  let generatedTitle: string | null = null;
  if (existingRows.length === 0 && !isCredentialReply) {
    generatedTitle = await generateConversationTitle((userMessage || contentToStore).trim().slice(0, 2000), manager, llmConfig);
    await db.update(conversations).set({ ...(generatedTitle && { title: generatedTitle }) }).where(eq(conversations.id, conversationId!)).run();
  }

  const llmTraceEntries: LLMTraceCall[] = [];
  let rephraseTraceEntry: LLMTraceCall | null = null;
  const trackingCallLLM = createTrackingCallLLM({ pushTrace: (e) => llmTraceEntries.push(e) });

  const trimmedForFallback = (userMessage || contentToStore).trim().slice(0, 2000);
  let rephrasedPrompt: string | undefined;
  let effectiveMessage: string;
  try {
    if (isCredentialReply && credentialResponse?.value) {
      effectiveMessage = credentialResponse.value.trim();
    } else if (hasContinueShellApproval && continueShellApproval) {
      effectiveMessage = buildContinueShellApprovalMessage({ ...continueShellApproval, command: continueShellApproval.command ?? "" });
    } else if (confirmationPathMessage) {
      effectiveMessage = confirmationPathMessage;
    } else if (shouldSkipRephrase(contentToStore, payload)) {
      effectiveMessage = trimmedForFallback;
    } else {
      const rephraseResult = await rephraseAndClassify(userMessage || contentToStore, manager, llmConfig, { onLlmCall: (e) => { rephraseTraceEntry = e; } });
      rephrasedPrompt = rephraseResult.rephrasedPrompt;
      effectiveMessage = rephraseResult.rephrasedPrompt ?? trimmedForFallback;
      if (rephraseResult.wantsRetry) {
        const allRows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId!)).orderBy(asc(chatMessages.createdAt));
        const lastUserMsg = [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
        if (lastUserMsg) effectiveMessage = lastUserMsg;
      }
    }

    const pendingPlanNonStream = conversationId ? pendingPlanByConversation.get(conversationId) : undefined;
    const result = useHeapMode
      ? await runHeapModeTurn({
          effectiveMessage,
          callLLM: trackingCallLLM,
          executeToolCtx: { conversationId, vaultKey, registry: getRegistry(loadSpecialistOverrides()) },
          registry: getRegistry(loadSpecialistOverrides()),
          manager,
          llmConfig,
          pushUsage: (r) => usageEntries.push({ response: r }),
          recentConversationContext: buildRecentConversationContext(history, chatSettings?.plannerRecentMessages ?? 12, {
            appendCurrentMessage: effectiveMessage,
          }),
          runWaitingContext: runWaitingContext,
          pendingPlan: pendingPlanNonStream ?? undefined,
          feedbackInjection: feedbackInjection || undefined,
          ragContext,
          uiContext: [uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
          studioContext,
          systemPromptOverride,
          temperature: chatTemperature,
          maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
        })
      : await runAssistant(history, effectiveMessage, {
          callLLM: trackingCallLLM,
          executeTool: (toolName: string, toolArgs: Record<string, unknown>) => executeTool(toolName, toolArgs, { conversationId, vaultKey }),
          feedbackInjection: feedbackInjection || undefined,
          ragContext,
          uiContext: [uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
          attachedContext: attachedContext || undefined,
          studioContext,
          crossChatContext: crossChatContextTrimmed,
          runWaitingContext: runWaitingContext,
          chatSelectedLlm: llmConfig ? { id: llmConfig.id, provider: llmConfig.provider, model: llmConfig.model } : undefined,
          systemPromptOverride,
          temperature: chatTemperature,
          maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
        });

    // Update pending plan store for heap (non-stream path). Merge created workflow/agent ids into extractedContext so next message has them.
    if (useHeapMode && conversationId) {
      if (hasWaitingForInputInToolResults(result.toolResults) && "plan" in result && result.plan) {
        const planToStore = mergeCreatedIdsIntoPlan(result.plan as PlannerOutput, result.toolResults) as PlannerOutput;
        pendingPlanByConversation.set(conversationId, planToStore);
      } else {
        pendingPlanByConversation.delete(conversationId);
      }
    }

    // Heap often presents options in prose only; inject synthetic ask_user so frontend can show clickables. Skip when format_response already present (agent chose to present a questionnaire).
    let toolResultsToUse = result.toolResults;
    const hasAskUserNonStream = toolResultsToUse.some((r) => r.name === "ask_user" || r.name === "ask_credentials");
    const hasFormatResponseNonStream = hasFormatResponseWithContent(toolResultsToUse);
    if (useHeapMode && !hasAskUserNonStream && !hasFormatResponseNonStream && manager && llmConfig && (result.content ?? "").trim().length > 0) {
      const callLLMForOptions = async (prompt: string) => {
        const res = await manager.chat(llmConfig as LLMConfig, { messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 512 });
        return res.content ?? "";
      };
      const extracted = await extractOptionsFromContentWithLLM(result.content, callLLMForOptions);
      if (extracted && extracted.length >= 1) {
        // #region agent log
        fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e0760a" }, body: JSON.stringify({ sessionId: "e0760a", location: "chat/route.ts:heap-inject-ask_user-nonstream", message: "Heap: injected synthetic ask_user", data: { optionCount: extracted.length, options: extracted.slice(0, 8) }, timestamp: Date.now(), hypothesisId: "H1" }) }).catch(() => {});
        // #endregion
        toolResultsToUse = [
          ...toolResultsToUse,
          { name: "ask_user", args: {} as Record<string, unknown>, result: { question: "Please pick an option", options: extracted } },
        ];
      }
    }
    // Normalize ask_user options via strict LLM format so frontend can parse reliably
    if (toolResultsToUse.length > 0 && manager && llmConfig) {
      toolResultsToUse = await normalizeAskUserOptionsInToolResults(toolResultsToUse, async (prompt) => {
        const res = await manager.chat(llmConfig as LLMConfig, { messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 512 });
        return res.content ?? "";
      });
    }

    // Heap multi-specialist: when display content has "Next steps" but ask_user is for a different question, derive interactivePrompt from content via strict LLM and override
    const displayContentForOverrideNonStream = getAssistantDisplayContent(result.content, toolResultsToUse);
    if (useHeapMode && displayContentForOverrideNonStream.length > 400 && manager && llmConfig) {
      const firstAskUserNonStream = toolResultsToUse.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
      if (firstAskUserNonStream?.result && typeof firstAskUserNonStream.result === "object") {
        const qNonStream = String((firstAskUserNonStream.result as { question?: string }).question ?? "").trim();
        const contentHasNextStepsNonStream = /\bnext steps?|pick one|choose one\b/i.test(displayContentForOverrideNonStream);
        if (qNonStream && !/next steps?|pick one|choose one/i.test(qNonStream) && contentHasNextStepsNonStream) {
          const callLLMForDeriveNonStream = async (prompt: string) => {
            const res = await manager.chat(llmConfig as LLMConfig, { messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 512 });
            return res.content ?? "";
          };
          const derivedNonStream = await deriveInteractivePromptFromContentWithLLM(displayContentForOverrideNonStream, callLLMForDeriveNonStream);
          if (derivedNonStream) {
            toolResultsToUse = toolResultsToUse.map((r) =>
              (r.name === "ask_user" || r.name === "ask_credentials") && r === firstAskUserNonStream
                ? { ...r, result: { ...(r.result as object), waitingForUser: true, question: derivedNonStream.question, options: derivedNonStream.options } }
                : r
            );
          }
        }
      }
    }

    // Save assistant message to DB (user message already saved above)
    const planToolCall = (result.reasoning || (result.todos && result.todos.length > 0))
      ? {
          id: crypto.randomUUID(),
          name: "__plan__",
          arguments: {
            ...(result.reasoning ? { reasoning: result.reasoning } : {}),
            ...(result.todos ? { todos: result.todos } : {}),
            ...(result.completedStepIndices ? { completedStepIndices: result.completedStepIndices } : {}),
          },
        }
      : undefined;
    const enrichedToolResults = await Promise.all(
      toolResultsToUse.map(async (r) => {
        let res = r.result;
        if (r.name === "get_agent" || r.name === "create_agent" || r.name === "update_agent") {
          res = await enrichAgentToolResult(r.result, r.args);
        }
        return { id: crypto.randomUUID(), name: r.name, arguments: r.args, result: res };
      })
    );
    const assistantToolCalls =
      toolResultsToUse.length > 0 || planToolCall
        ? [...enrichedToolResults, ...(planToolCall ? [planToolCall] : [])]
        : undefined;
    const fullLlmTrace = rephraseTraceEntry ? [rephraseTraceEntry, ...llmTraceEntries] : llmTraceEntries;
    const displayContent = getAssistantDisplayContent(result.content, toolResultsToUse);
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: displayContent || getAskUserQuestionFromToolResults(toolResultsToUse) || "",
      toolCalls: assistantToolCalls,
      llmTrace: fullLlmTrace.length > 0 ? fullLlmTrace : undefined,
      ...(rephrasedPrompt != null && rephrasedPrompt.trim() && { rephrasedPrompt }),
      createdAt: Date.now(),
      conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
    if (conversationId && hasWaitingForInputInToolResults(toolResultsToUse)) {
      await createChatNotification(conversationId);
    }
    const msgCount = existingRows.length + 2;
    const convRowsForSummary = await db.select({ summary: conversations.summary }).from(conversations).where(eq(conversations.id, conversationId!));
    if (msgCount >= 6 && convRowsForSummary.length > 0 && (convRowsForSummary[0].summary == null || convRowsForSummary[0].summary === "")) {
      summarizeConversation(conversationId!, manager, llmConfig).catch(() => {});
    }

    // Log token usage for each LLM call
    for (const entry of usageEntries) {
      const usage = entry.response.usage;
      if (usage && usage.totalTokens > 0) {
        const pricing = resolveModelPricing(llmConfig.model, customPricing);
        const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
        await db.insert(tokenUsage).values(toTokenUsageRow({
          id: crypto.randomUUID(),
          provider: llmConfig.provider,
          model: llmConfig.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          estimatedCost: cost != null ? String(cost) : null,
        })).run();
      }
    }

    await db.update(conversations).set({
      lastUsedProvider: llmConfig.provider,
      lastUsedModel: llmConfig.model,
    }).where(eq(conversations.id, conversationId!)).run();

    return json({
      content: displayContent,
      toolResults: toolResultsToUse,
      messageId: assistantMsg.id,
      userMessageId: userMsg.id,
      conversationId,
      reasoning: result.reasoning,
      todos: result.todos,
      completedStepIndices: result.completedStepIndices,
      rephrasedPrompt,
      ...(generatedTitle && { conversationTitle: generatedTitle }),
      ...(useHeapMode &&
        "refinedTask" in result &&
        "priorityOrder" in result && { planSummary: { refinedTask: result.refinedTask, route: result.priorityOrder } }),
    });
  } catch (err: unknown) {
    logApiError("/api/chat", "POST", err);
    const msg = normalizeChatError(err, llmConfig ? { provider: llmConfig.provider, model: llmConfig.model, endpoint: llmConfig.endpoint } : undefined);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e31fdf'},body:JSON.stringify({sessionId:'e31fdf',location:'chat/route.ts:500',message:'chat 500',data:{msgSnippet:(msg||'').slice(0,300)},hypothesisId:'H2',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return json({ error: msg }, { status: 500 });
  }
  };

  const streamRequested = request.url.includes("stream=1") || request.headers.get("accept")?.includes("text/event-stream");
  if (streamRequested) {
    const turnId = crypto.randomUUID();
    const persistQueueLogForChannel = (data: object) => {
      const d = data as Record<string, unknown>;
      const t = d.type as string;
      if (!t || !conversationId) return;
      const label =
        (d.label as string) ??
        (d.todoLabel as string) ??
        (d.subStepLabel as string) ??
        (t === "done" ? "Done" : t === "plan" ? "Plan" : t === "rephrased_prompt" ? "Rephrased prompt" : t === "error" ? "Error" : null);
      void db
        .insert(messageQueueLog)
        .values({
          id: crypto.randomUUID(),
          conversationId,
          messageId: (d.messageId as string) ?? null,
          type: t,
          phase: (d.phase as string) ?? null,
          label,
          payload: JSON.stringify(d),
          createdAt: Date.now(),
        })
        .run();
    };
    const writer = {
      enqueue(d: Record<string, unknown>) {
        channelPublish(turnId, d as import("../_lib/chat-event-channel").ChatChannelEvent);
        const dd = d as Record<string, unknown>;
        const tt = dd.type as string;
        // #region agent log
        if (tt === "trace_step" || tt === "step_start") {
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"chat/route.ts:enqueue",message:"publish event",data:{turnId,eventType:tt},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion
        if (tt === "trace_step" || tt === "step_start" || tt === "todo_done" || tt === "plan" || tt === "done" || tt === "error" || tt === "rephrased_prompt") {
          persistQueueLogForChannel(d);
        }
      },
    };
    const lockKey = conversationId ?? `temp-${turnId}`;
    const job = (): Promise<void> =>
      runSerializedByConversation(lockKey, async () => executeTurn(writer, turnId)).then(() => {});
    setPendingJob(turnId, job);
    const FALLBACK_JOB_MS = 4000;
    setTimeout(() => {
      const taken = takePendingJob(turnId);
      if (taken) taken().catch(() => {});
    }, FALLBACK_JOB_MS);
    return json({ turnId, ...(conversationId && { conversationId }) }, { status: 202 });
  }

  let alreadyLocked = false;
  try {
    const now = Date.now();
    await db.insert(conversationLocks).values({ conversationId, startedAt: now, createdAt: now }).run();
    alreadyLocked = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/UNIQUE|unique|SqliteError.*primary/i.test(msg)) throw e;
  }
  return runSerializedByConversation(conversationId, async () => executeTurn(undefined, undefined), { alreadyLocked });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId")?.trim() || undefined;
    const query = conversationId
      ? db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId))
      : db.select().from(chatMessages);
    const rows = await query;
    const messages = rows.map((r) => {
      const msg = fromChatMessageRow(r);
      if (msg.role !== "assistant" || !msg.toolCalls) return msg;
      const toolResults = msg.toolCalls.map((t) => ({ name: t.name, args: t.arguments, result: t.result }));
      const turnStatus = getTurnStatusFromToolResults(toolResults, { useLastAskUser: true });
      const planCall = msg.toolCalls.find((t) => t.name === "__plan__");
      const planArgs = (planCall?.arguments ?? {}) as { todos?: unknown; completedStepIndices?: unknown };
      const todos = Array.isArray(planArgs.todos) ? planArgs.todos.filter((x): x is string => typeof x === "string") : undefined;
      const completedStepIndices = Array.isArray(planArgs.completedStepIndices)
        ? planArgs.completedStepIndices.filter((x): x is number => typeof x === "number")
        : undefined;
      return {
        ...msg,
        status: turnStatus.status,
        ...(turnStatus.interactivePrompt && { interactivePrompt: turnStatus.interactivePrompt }),
        ...(todos != null && { todos }),
        ...(completedStepIndices != null && { completedStepIndices }),
      };
    });
    return json(messages);
  } catch (err) {
    logApiError("/api/chat", "GET", err);
    const message = err instanceof Error ? err.message : "Failed to load messages";
    return json({ error: message }, { status: 500 });
  }
}

/** Register runner for scheduled assistant tasks (e.g. reminder with taskType "assistant_task"). Runs one full turn with the given user message. */
registerScheduledTurnRunner(async (conversationId, userMessageContent) => {
  await runSerializedByConversation(conversationId, async () => {
    const MAX_HISTORY_MESSAGES = 50;
    const existingRows = await db
      .select({ role: chatMessages.role, content: chatMessages.content, toolCalls: chatMessages.toolCalls })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt));
    let history: LLMMessage[] = existingRows.map((r) => {
      const role = r.role as "user" | "assistant" | "system";
      let content = r.content ?? "";
      if (role === "assistant" && !content.trim() && r.toolCalls) {
        try {
          const parsed = typeof r.toolCalls === "string" ? (JSON.parse(r.toolCalls) as { name: string; result?: unknown }[]) : undefined;
          const q = getAskUserQuestionFromToolResults(parsed);
          if (q) content = q;
        } catch {
          // ignore
        }
      }
      return { role, content };
    });
    if (history.length > MAX_HISTORY_MESSAGES) history = history.slice(-MAX_HISTORY_MESSAGES);

    const configRows = await db.select().from(llmConfigs);
    if (configRows.length === 0) throw new Error("No LLM provider configured.");
    const configsWithSecret = configRows.map(fromLlmConfigRowWithSecret);
    const convRows = await db.select({ lastUsedProvider: conversations.lastUsedProvider, lastUsedModel: conversations.lastUsedModel }).from(conversations).where(eq(conversations.id, conversationId));
    const conv = convRows[0];
    let llmConfig = conv?.lastUsedProvider ? configsWithSecret.find((c) => c.id === conv.lastUsedProvider) : undefined;
    if (!llmConfig) llmConfig = configsWithSecret[0];

    let chatSettings: { contextAgentIds: string[] | null; contextWorkflowIds: string[] | null; contextToolIds: string[] | null; temperature: number | null } | null = null;
    try {
      const settingsRows = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, "default"));
      chatSettings = settingsRows.length > 0 ? fromChatAssistantSettingsRow(settingsRows[0]) : null;
    } catch {
      // ignore
    }
    const chatTemperature = chatSettings?.temperature ?? 0.7;

    await ensureStandardTools();
    const [agentRows, workflowRows, toolRows, llmRows] = await Promise.all([
      db.select().from(agents),
      db.select().from(workflows),
      db.select().from(tools),
      db.select().from(llmConfigs),
    ]);
    const agentIds = chatSettings?.contextAgentIds;
    const workflowIds = chatSettings?.contextWorkflowIds;
    const toolIdsFilter = chatSettings?.contextToolIds;
    const studioContext: StudioContext = {
      tools: (toolIdsFilter == null || toolIdsFilter.length === 0 ? toolRows.map(fromToolRow) : toolRows.map(fromToolRow).filter((t) => toolIdsFilter!.includes(t.id))).map((t) => ({ id: t.id, name: t.name, protocol: t.protocol })),
      agents: (agentIds == null || agentIds.length === 0 ? agentRows.map(fromAgentRow) : agentRows.map(fromAgentRow).filter((a) => agentIds!.includes(a.id))).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      workflows: (workflowIds == null || workflowIds.length === 0 ? workflowRows.map(fromWorkflowRow) : workflowRows.map(fromWorkflowRow).filter((w) => workflowIds!.includes(w.id))).map((w) => ({ id: w.id, name: w.name, executionMode: w.executionMode })),
      llmProviders: llmRows.map(fromLlmConfigRow).map((c) => ({ id: c.id, provider: c.provider, model: c.model })),
    };

    const fbRows = await db.select().from(feedback).where(eq(feedback.targetType, "chat"));
    const feedbackInjection = buildFeedbackInjection(fbRows.map(fromFeedbackRow).slice(-10));
    const studioCollectionId = await getDeploymentCollectionId();
    const ragChunks = studioCollectionId ? await retrieveChunks(studioCollectionId, userMessageContent, 5) : [];
    const ragContext = ragChunks.length > 0 ? ragChunks.map((c) => c.text).join("\n\n") : undefined;

    const manager = createDefaultLLMManager(async (ref) => ref ? process.env[ref] : undefined);
    const usageEntries: { response: LLMResponse }[] = [];
    const trackingCallLLM = async (req: LLMRequest): Promise<LLMResponse> => {
      const response = await manager.chat(llmConfig as LLMConfig, req, { source: "chat" });
      usageEntries.push({ response });
      return response;
    };

    const result = await runAssistant(history, userMessageContent.trim().slice(0, 2000), {
      callLLM: trackingCallLLM,
      executeTool: (name: string, args: Record<string, unknown>) => executeTool(name, args, { conversationId, vaultKey: null }),
      feedbackInjection: feedbackInjection || undefined,
      ragContext,
      uiContext: getSystemContext(),
      studioContext,
      chatSelectedLlm: llmConfig ? { id: llmConfig.id, provider: llmConfig.provider, model: llmConfig.model } : undefined,
      temperature: chatTemperature,
      maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
    });

    const displayContent = getAssistantDisplayContent(result.content, result.toolResults);
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: displayContent || getAskUserQuestionFromToolResults(result.toolResults) || "",
      toolCalls: result.toolResults.length > 0 ? result.toolResults.map((r) => ({ id: crypto.randomUUID(), name: r.name, arguments: r.args, result: r.result })) : undefined,
      llmTrace: undefined,
      createdAt: Date.now(),
      conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
    if (conversationId && hasWaitingForInputInToolResults(result.toolResults)) {
      await createChatNotification(conversationId);
    }
    await db.update(conversations).set({ lastUsedProvider: llmConfig.provider, lastUsedModel: llmConfig.model }).where(eq(conversations.id, conversationId)).run();
    for (const entry of usageEntries) {
      const usage = entry.response.usage;
      if (usage && usage.totalTokens > 0) {
        const pricingRows = await db.select().from(modelPricing);
        const customPricing: Record<string, { input: number; output: number }> = {};
        for (const r of pricingRows) {
          const p = fromModelPricingRow(r);
          customPricing[p.modelPattern] = { input: Number(p.inputCostPerM), output: Number(p.outputCostPerM) };
        }
        const pricing = resolveModelPricing(llmConfig.model, customPricing);
        const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
        await db.insert(tokenUsage).values(toTokenUsageRow({
          id: crypto.randomUUID(),
          provider: llmConfig.provider,
          model: llmConfig.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          estimatedCost: cost != null ? String(cost) : null,
        })).run();
      }
    }
  });
});
