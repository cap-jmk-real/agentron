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
import { enqueueWorkflowResume } from "../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../_lib/rag";
import type { RemoteServer } from "../_lib/db";
import { testRemoteConnection } from "../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../_lib/naming";
import { runSerializedByConversation } from "../_lib/chat-queue";
import { publish as channelPublish, finish as channelFinish, setPendingJob } from "../_lib/chat-event-channel";
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
} from "../_lib/chat-helpers";
import { openclawSend, openclawHistory, openclawAbort } from "../_lib/openclaw-client";
import { eq, asc, desc, isNotNull, and, like, inArray } from "drizzle-orm";
import type { LLMTraceCall, LLMConfig } from "@agentron-studio/core";
import { runAssistant, buildFeedbackInjection, createDefaultLLMManager, resolveModelPricing, calculateCost, type StudioContext, searchWeb, fetchUrl, refinePrompt, getRegistry, runHeap, buildRouterPrompt, parseRouterOutput } from "@agentron-studio/runtime";
import { getContainerManager, withContainerInstallHint } from "../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../_lib/credential-store";
import { getVaultKeyFromRequest } from "../_lib/vault";
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

const TRACE_PAYLOAD_MAX = 400;

function truncateForTrace(v: unknown): unknown {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= TRACE_PAYLOAD_MAX ? v : s.slice(0, TRACE_PAYLOAD_MAX) + "…";
}

/** Run one turn in heap (multi-agent) mode: router LLM → run heap with specialists; returns assistant-shaped result. */
async function runHeapModeTurn(opts: {
  effectiveMessage: string;
  callLLM: (req: LLMRequest) => Promise<LLMResponse>;
  executeToolCtx: { conversationId: string | undefined; vaultKey: Buffer | null | undefined };
  registry: ReturnType<typeof getRegistry>;
  manager: ReturnType<typeof createDefaultLLMManager>;
  llmConfig: LLMConfig | null;
  pushUsage: (response: LLMResponse) => void;
  enqueueTrace?: (step: { phase: string; label?: string; specialistId?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown; contentPreview?: string; /** Heap route from router (for heap_route trace step). */ priorityOrder?: unknown; refinedTask?: string }) => void;
  /** When set, heap sets this to the current specialist id so LLM trace steps can include specialistId. */
  currentSpecialistIdRef?: { current: string | null };
  feedbackInjection?: string;
  ragContext?: string;
  uiContext?: string;
  studioContext?: StudioContext;
  systemPromptOverride?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ content: string; toolResults: { name: string; args: Record<string, unknown>; result: unknown }[]; reasoning?: string; todos?: string[]; completedStepIndices?: number[] }> {
  const { effectiveMessage, callLLM, executeToolCtx, registry, manager, llmConfig, pushUsage, enqueueTrace, currentSpecialistIdRef } = opts;
  const traceId = crypto.randomUUID();
  enqueueTrace?.({ phase: "router", label: "Routing…" });

  const routerPrompt = buildRouterPrompt(effectiveMessage, registry);
  const routerResponse = await manager.chat(llmConfig as LLMConfig, {
    messages: [{ role: "user", content: routerPrompt }],
    temperature: 0.2,
    maxTokens: 1024,
  }, { source: "chat" });
  pushUsage(routerResponse);

  const parsed = parseRouterOutput(routerResponse.content ?? "");
  const priorityOrder = parsed?.priorityOrder ?? (registry.topLevelIds[0] ? [registry.topLevelIds[0]] : []);
  const refinedTask = parsed?.refinedTask ?? effectiveMessage;

  const routeLabelPart = priorityOrder
    .map((s) => (typeof s === "string" ? s : Array.isArray((s as { parallel?: string[] }).parallel) ? `[${(s as { parallel: string[] }).parallel.join(", ")}]` : String(s)))
    .join(" → ");
  enqueueTrace?.({
    phase: "heap_route",
    label: `Route: ${routeLabelPart || "—"}`,
    priorityOrder,
    refinedTask,
  });
  enqueueTrace?.({ phase: "heap", label: "Running specialists…" });

  const allHeapToolResults: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
  type RunSpecialist = (specialistId: string, task: string, context: { steps: { specialistId: string; outcome: string }[] }) => Promise<{ summary: string }>;
  const runSpecialistInner: RunSpecialist = async (specialistId, task, context) => {
    const specialist = registry.specialists[specialistId];
    if (!specialist) return { summary: `Unknown specialist: ${specialistId}.` };
    const toolNames = specialist.toolNames;
    const contextStr = context.steps.length
      ? context.steps.map((s) => `${s.specialistId}: ${s.outcome}`).join("\n")
      : "";
    const specialistMessage = contextStr ? `${task}\n\nPrevious steps:\n${contextStr}` : task;
    const priorResults: { name: string; result: unknown }[] = [];
    const execTool = async (name: string, args: Record<string, unknown>) => {
      if (!toolNames.includes(name)) {
        return { error: "Tool not available for this specialist." };
      }
      const resolved = resolveTemplateVars(args, priorResults);
      enqueueTrace?.({ phase: "heap_tool", label: `${specialistId} → ${name}`, specialistId, toolName: name, toolInput: truncateForTrace(resolved) });
      const result = await executeTool(name, resolved, executeToolCtx);
      priorResults.push({ name, result });
      enqueueTrace?.({ phase: "heap_tool_done", label: `${specialistId} → ${name}`, specialistId, toolName: name, toolOutput: truncateForTrace(result) });
      return result;
    };
    const result = await runAssistant([], specialistMessage, {
      callLLM,
      executeTool: execTool,
      systemPromptOverride: `You are the "${specialistId}" specialist. Use only these tools: ${toolNames.join(", ")}. Complete the task and respond with a brief summary.
When the task requires creating, updating, or configuring agents, workflows, or tools, you MUST output <tool_call> blocks in your FIRST response. Use this format: <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>. Do not respond with only a summary or "I will..." — output the actual tool calls immediately so the system can execute them.
When presenting choices, call ask_user with question and 2–4 options.`,
      feedbackInjection: opts.feedbackInjection,
      ragContext: opts.ragContext,
      uiContext: opts.uiContext,
      studioContext: opts.studioContext,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens ?? 16384,
    });
    if (result.toolResults.length > 0) {
      for (const tr of result.toolResults) {
        allHeapToolResults.push({ name: tr.name, args: tr.args, result: tr.result });
      }
    }
    const summary = (result.content ?? "").trim().slice(0, 16000) || (result.toolResults.length > 0 ? "Done." : "No output.");
    return { summary };
  };

  const runSpecialist: RunSpecialist = async (specialistId, task, context) => {
    enqueueTrace?.({ phase: "heap_specialist", label: `Specialist ${specialistId}…`, specialistId });
    if (currentSpecialistIdRef) currentSpecialistIdRef.current = specialistId;
    try {
      const result = await runSpecialistInner(specialistId, task, context);
      enqueueTrace?.({ phase: "heap_specialist_done", label: `${specialistId}: ${result.summary.slice(0, 80)}${result.summary.length > 80 ? "…" : ""}`, specialistId, contentPreview: result.summary });
      return result;
    } finally {
      if (currentSpecialistIdRef) currentSpecialistIdRef.current = null;
    }
  };

  const heapResult = await runHeap(priorityOrder, refinedTask, runSpecialist, registry, {
    traceId,
    log: (msg, data) => {
      if (typeof console !== "undefined" && console.info) {
        console.info(msg, data ?? "");
      }
    },
  });

  return { content: heapResult.summary, toolResults: allHeapToolResults, reasoning: undefined, todos: undefined, completedStepIndices: undefined };
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

  if (conversationId) clearActiveBySourceId("chat", conversationId);

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
  let chatSettings: { customSystemPrompt: string | null; contextAgentIds: string[] | null; contextWorkflowIds: string[] | null; contextToolIds: string[] | null; recentSummariesCount: number | null; temperature: number | null; historyCompressAfter: number | null; historyKeepRecent: number | null } | null = null;
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
    enqueueTraceStep?: (step: { phase: string; label?: string; messageCount?: number; contentPreview?: string; inputPreview?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; specialistId?: string }) => void;
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
      opts.enqueueTraceStep?.({ phase: "llm_request", label: "Calling LLM…", messageCount: req.messages.length, inputPreview, ...extra });
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

          const result = useHeapMode
            ? await runHeapModeTurn({
                effectiveMessage,
                callLLM: streamTrackingCallLLM,
                executeToolCtx: { conversationId, vaultKey },
                registry: getRegistry(),
                manager,
                llmConfig,
                pushUsage: (r) => usageEntries.push({ response: r }),
                enqueueTrace: (step) => enqueue({ type: "trace_step", ...step }),
                currentSpecialistIdRef,
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

          // Heap often presents options in prose only; inject synthetic ask_user so frontend can show clickables
          let toolResultsToUse = result.toolResults;
          const hasAskUser = toolResultsToUse.some((r) => r.name === "ask_user" || r.name === "ask_credentials");
          if (useHeapMode && !hasAskUser && manager && llmConfig && (result.content ?? "").trim().length > 0) {
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
          const turnStatus = getTurnStatusFromToolResults(toolResultsToUse);
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
            createChatNotification(conversationId);
          }

          // Mark done before sending so we don't send an error event if the client already disconnected (safeEnqueue no-ops).
          doneSent = true;
          enqueue({
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
          });

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
            try {
              const assistantErrorMsg = {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: `Error: ${msg}`,
                createdAt: Date.now(),
                conversationId,
              };
              await db.insert(chatMessages).values(toChatMessageRow(assistantErrorMsg)).run();
              enqueue({ type: "error", error: msg, messageId: assistantErrorMsg.id, userMessageId: userMsg.id });
            } catch (persistErr) {
              enqueue({ type: "error", error: msg });
            }
          }
        } finally {
          channelFinish(turnId);
        }
    return;
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

    const result = useHeapMode
      ? await runHeapModeTurn({
          effectiveMessage,
          callLLM: trackingCallLLM,
          executeToolCtx: { conversationId, vaultKey },
          registry: getRegistry(),
          manager,
          llmConfig,
          pushUsage: (r) => usageEntries.push({ response: r }),
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

    // Heap often presents options in prose only; inject synthetic ask_user so frontend can show clickables
    let toolResultsToUse = result.toolResults;
    const hasAskUserNonStream = toolResultsToUse.some((r) => r.name === "ask_user" || r.name === "ask_credentials");
    if (useHeapMode && !hasAskUserNonStream && manager && llmConfig && (result.content ?? "").trim().length > 0) {
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
      createChatNotification(conversationId);
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
        (t === "done" ? "Done" : t === "plan" ? "Plan" : t === "rephrased_prompt" ? "Rephrased prompt" : null);
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
      enqueue(d: object) {
        channelPublish(turnId, d);
        const dd = d as Record<string, unknown>;
        const tt = dd.type as string;
        if (tt === "trace_step" || tt === "step_start" || tt === "todo_done" || tt === "plan" || tt === "done" || tt === "error" || tt === "rephrased_prompt") {
          persistQueueLogForChannel(d);
        }
      },
    };
    // #region agent log
    if (typeof fetch !== "undefined") fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e0760a'},body:JSON.stringify({sessionId:'e0760a',location:'chat/route.ts:setPendingJob',message:'scheduling job',data:{turnId,conversationId:conversationId ?? null,hasConversationId:conversationId != null},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setPendingJob(turnId, () =>
      runSerializedByConversation(conversationId, async () => executeTurn(writer, turnId))
    );
    return json({ turnId }, { status: 202 });
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
      const turnStatus = getTurnStatusFromToolResults(toolResults);
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
      createChatNotification(conversationId);
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
