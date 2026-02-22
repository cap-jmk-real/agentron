import { json } from "../../_lib/response";
import { logApiError } from "../../_lib/api-logger";
import {
  db,
  agents,
  workflows,
  tools,
  llmConfigs,
  executions,
  files,
  sandboxes,
  customFunctions,
  feedback,
  conversations,
  conversationLocks,
  chatMessages,
  chatAssistantSettings,
  assistantMemory,
  fromChatAssistantSettingsRow,
  toChatAssistantSettingsRow,
  fromAssistantMemoryRow,
  toAssistantMemoryRow,
  tokenUsage,
  modelPricing,
  remoteServers,
  toTokenUsageRow,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
  fromLlmConfigRow,
  fromLlmConfigRowWithSecret,
  fromFeedbackRow,
  fromFileRow,
  fromSandboxRow,
  fromModelPricingRow,
  toAgentRow,
  toWorkflowRow,
  toToolRow,
  toCustomFunctionRow,
  toSandboxRow,
  toChatMessageRow,
  fromChatMessageRow,
  toConversationRow,
  fromRemoteServerRow,
  toRemoteServerRow,
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
} from "../../_lib/db";
import { scheduleReminder, cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { registerScheduledTurnRunner } from "../../_lib/run-scheduled-turn";
import {
  runWorkflow,
  RUN_CANCELLED_MESSAGE,
  WAITING_FOR_USER_MESSAGE,
  WaitingForUserError,
} from "../../_lib/run-workflow";
import { executeTool, enrichAgentToolResult, resolveTemplateVars } from "./execute-tool";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";
import { getRelevantFeedbackForScope } from "../../_lib/feedback-retrieval";
import { getEffectiveRagRetrieveLimit, getEffectiveFeedbackLimits } from "../../_lib/rag-limits";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { enqueueWorkflowResume, processOneWorkflowJob } from "../../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../../_lib/rag";
import type { RemoteServer } from "../../_lib/db";
import { testRemoteConnection } from "../../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../../_lib/naming";
import { runSerializedByConversation } from "../../_lib/chat-queue";
import {
  publish as channelPublish,
  finish as channelFinish,
  setPendingJob,
  takePendingJob,
} from "../../_lib/chat-event-channel";
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
} from "../../_lib/chat-helpers";
import { openclawSend, openclawHistory, openclawAbort } from "../../_lib/openclaw-client";
import { eq, asc, desc, isNotNull, and, like, inArray } from "drizzle-orm";
import type { LLMTraceCall, LLMConfig } from "@agentron-studio/core";
import { ragConnectors } from "@agentron-studio/core";
import {
  runAssistant,
  buildFeedbackInjection,
  createDefaultLLMManager,
  resolveModelPricing,
  calculateCost,
  type StudioContext,
  searchWeb,
  fetchUrl,
  refinePrompt,
  getRegistry,
  buildRouterPrompt,
  parseRouterOutput,
  SYSTEM_PROMPT,
} from "@agentron-studio/runtime";
import { getContainerManager, withContainerInstallHint } from "../../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../../_lib/credential-store";
import { getVaultKeyFromRequest } from "../../_lib/vault";
import { loadSpecialistOverrides } from "../../_lib/specialist-overrides";
import {
  createRunNotification,
  createChatNotification,
  clearActiveBySourceId,
} from "../../_lib/notifications-store";
import type { LLMMessage, LLMRequest, LLMResponse, PlannerOutput } from "@agentron-studio/runtime";
import { runShellCommand } from "../../_lib/shell-exec";
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
} from "./run-turn-helpers";
import {
  DEFAULT_RECENT_SUMMARIES_COUNT,
  MIN_SUMMARIES,
  MAX_SUMMARIES,
  LAST_MESSAGES_PER_RECENT_CHAT,
  pendingPlanByConversation,
  sanitizeDonePayload,
  buildRecentConversationContext,
  AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION,
} from "./chat-route-shared";
import { runHeapModeTurn } from "./chat-route-heap";
import { executeTurnImpl, type ExecuteTurnState } from "./chat-route-execute-turn";

/** Build connectors array for StudioContext from RAG connector rows. Used so unit tests can assert the mapping. */
export function studioContextConnectorsFromRows(
  rows: { id: string; type: string }[]
): { id: string; type: string }[] {
  return rows.map((r) => ({ id: r.id, type: r.type }));
}

export async function runChatPost(request: Request): Promise<Response> {
  const payload = await request.json();
  const userMessage = payload.message as string;
  const providerId = payload.providerId as string | undefined;
  const uiContext = typeof payload.uiContext === "string" ? payload.uiContext.trim() : undefined;
  const attachedContext =
    typeof payload.attachedContext === "string" ? payload.attachedContext.trim() : undefined;
  let conversationId =
    typeof payload.conversationId === "string"
      ? payload.conversationId.trim() || undefined
      : undefined;
  const conversationTitle =
    typeof payload.conversationTitle === "string"
      ? payload.conversationTitle.trim() || undefined
      : undefined;
  const credentialResponse = payload.credentialResponse as
    | { credentialKey?: string; value?: string; save?: boolean }
    | undefined;
  const isCredentialReply =
    credentialResponse &&
    typeof credentialResponse.value === "string" &&
    credentialResponse.value.trim() !== "";

  const useHeapMode = payload.useHeapMode === true;

  const continueShellApproval = payload.continueShellApproval as
    | { command?: string; stdout?: string; stderr?: string; exitCode?: number }
    | undefined;
  const hasContinueShellApproval =
    continueShellApproval != null &&
    typeof continueShellApproval === "object" &&
    typeof (continueShellApproval.command ?? "") === "string" &&
    (continueShellApproval.command ?? "").trim() !== "";

  if (!userMessage && !isCredentialReply && !hasContinueShellApproval) {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e31fdf" },
      body: JSON.stringify({
        sessionId: "e31fdf",
        location: "chat/route.ts:400",
        message: "chat 400 message required",
        data: { reason: "message required" },
        hypothesisId: "H1",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return json({ error: "message required" }, { status: 400 });
  }
  if (hasContinueShellApproval && !conversationId) {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e31fdf" },
      body: JSON.stringify({
        sessionId: "e31fdf",
        location: "chat/route.ts:400",
        message: "chat 400 conversationId required",
        data: { reason: "conversationId required" },
        hypothesisId: "H1",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return json(
      { error: "conversationId required when using continueShellApproval" },
      { status: 400 }
    );
  }

  const vaultKey = getVaultKeyFromRequest(request);
  const contentToStore = isCredentialReply
    ? "Credentials provided."
    : hasContinueShellApproval
      ? "Command approved and run."
      : userMessage || "";
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    await db
      .insert(conversations)
      .values(
        toConversationRow({
          id: conversationId,
          title: conversationTitle ?? null,
          rating: null,
          note: null,
          summary: null,
          lastUsedProvider: null,
          lastUsedModel: null,
          createdAt: Date.now(),
        })
      )
      .run();
  }
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e0760a" },
    body: JSON.stringify({
      sessionId: "e0760a",
      location: "chat/route.ts:POST_received",
      message: "POST received",
      data: {
        conversationId: conversationId ?? null,
        streamRequested:
          request.url.includes("stream=1") ||
          request.headers.get("accept")?.includes("text/event-stream"),
        messageLen: (userMessage || "").length,
      },
      hypothesisId: "H1",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (conversationId) await clearActiveBySourceId("chat", conversationId);

  // When user submits credentials, save to vault (only when vault is unlocked)
  if (isCredentialReply && credentialResponse?.credentialKey && credentialResponse.save) {
    const key =
      String(credentialResponse.credentialKey).trim().toLowerCase().replace(/\s+/g, "_") ||
      "credential";
    const plaintext = credentialResponse.value!.trim();
    await setStoredCredential(key, plaintext, true, vaultKey);
  }

  const bypassRunResponse = payload.bypassRunResponse === true;
  const runIdFromClient =
    typeof payload.runId === "string" ? payload.runId.trim() || undefined : undefined;
  let didAutoForwardToRun = false;
  let forwardedRunId: string | null = null;

  // Option 3: when a run is waiting for user input (or a run is executing), inject run context so the Chat assistant
  // can respond to the right run and does not confuse multiple runs (e.g. one finished, one running).
  let runWaitingContext: string | undefined;
  if (!bypassRunResponse && !isCredentialReply && conversationId) {
    let waitingRows = await db
      .select({ id: executions.id, targetId: executions.targetId, output: executions.output })
      .from(executions)
      .where(
        and(
          eq(executions.status, "waiting_for_user"),
          eq(executions.conversationId, conversationId)
        )
      )
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
        const runRow = await db
          .select({ status: executions.status })
          .from(executions)
          .where(eq(executions.id, runIdFromClient))
          .limit(1);
        if (runRow[0]?.status === "waiting_for_user") {
          waitingRows = byRunId;
          await db
            .update(executions)
            .set({ conversationId })
            .where(eq(executions.id, runIdFromClient))
            .run();
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
      runWaitingContext +=
        "\n**Rule:** When referring to this run, use runId " + runningRunId + ".";
    }
    if (waitingRows.length > 0) {
      const runId = waitingRows[0].id;
      let current: Record<string, unknown> | undefined;
      try {
        const raw = waitingRows[0].output;
        current =
          typeof raw === "string"
            ? (JSON.parse(raw) as Record<string, unknown>)
            : raw != null
              ? (raw as Record<string, unknown>)
              : undefined;
      } catch {
        current = undefined;
      }
      // Run output can be: (1) flat { question, message, suggestions } from request_user_help, or
      // (2) wrapped { output: {...}, trail: [...] } from executionOutputSuccess
      const inner =
        current && typeof current.output === "object" && current.output !== null
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
        runWaitingContext +=
          "\n**Rule:** There are two runs (one waiting for input, one executing). Always be clear which run you refer to. If the user's message does not clearly refer to one run, ask: \"Do you mean the run waiting for your input, or the one that's still executing?\"";
      }
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "chat/route.ts:runWaitingContext",
          message: "run waiting context set for chat",
          data: { runId, conversationId },
          hypothesisId: "H1",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
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
          const existingOutput =
            current &&
            typeof current === "object" &&
            !Array.isArray(current) &&
            current.output !== undefined
              ? current.output
              : undefined;
          const existingTrail = Array.isArray(current?.trail) ? current.trail : [];
          const mergedOutput = {
            ...(existingOutput &&
            typeof existingOutput === "object" &&
            !Array.isArray(existingOutput)
              ? existingOutput
              : {}),
            userResponded: true,
            response,
          };
          const outPayload = executionOutputSuccess(
            mergedOutput,
            existingTrail.length > 0 ? existingTrail : undefined
          );
          await db
            .update(executions)
            .set({ status: "running", finishedAt: null, output: JSON.stringify(outPayload) })
            .where(eq(executions.id, runId))
            .run();
          const replyPreview = response.length > 80 ? response.slice(0, 77) + "…" : response;
          await db
            .insert(runLogs)
            .values({
              id: crypto.randomUUID(),
              executionId: runId,
              level: "stdout",
              message: `User replied (Chat): ${replyPreview}`,
              payload: null,
              createdAt: Date.now(),
            })
            .run();
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
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      toolCalls: chatMessages.toolCalls,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
  if (existingRows.length > 0) {
    const trimmed =
      existingRows.length > MAX_HISTORY_MESSAGES
        ? existingRows.slice(-MAX_HISTORY_MESSAGES)
        : existingRows;
    history = trimmed.map((r) => {
      const role = r.role as "user" | "assistant" | "system";
      let content = r.content ?? "";
      // When assistant message has no content (e.g. only tool calls), use ask_user question from toolCalls so the next turn retains context (e.g. "3" → option 3).
      if (role === "assistant" && !content.trim()) {
        const parsed = (() => {
          try {
            return typeof r.toolCalls === "string"
              ? (JSON.parse(r.toolCalls) as { name: string; result?: unknown }[])
              : undefined;
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
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e31fdf" },
      body: JSON.stringify({
        sessionId: "e31fdf",
        location: "chat/route.ts:400",
        message: "chat 400 no LLM configured",
        data: { reason: "no LLM" },
        hypothesisId: "H1_H5",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return json(
      { error: "No LLM provider configured. Go to LLM Settings to add one." },
      { status: 400 }
    );
  }
  const configsWithSecret = configRows.map(fromLlmConfigRowWithSecret);
  let llmConfig: (typeof configsWithSecret)[0] | undefined;
  if (providerId) {
    llmConfig = configsWithSecret.find((c) => c.id === providerId);
    if (!llmConfig) {
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e31fdf" },
        body: JSON.stringify({
          sessionId: "e31fdf",
          location: "chat/route.ts:400",
          message: "chat 400 provider not found",
          data: { providerId },
          hypothesisId: "H5",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return json({ error: "Selected provider not found or was removed." }, { status: 400 });
    }
  } else {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e31fdf" },
      body: JSON.stringify({
        sessionId: "e31fdf",
        location: "chat/route.ts:400",
        message: "chat 400 no provider selected",
        data: { reason: "no providerId" },
        hypothesisId: "H5",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return json({ error: "Please select an LLM provider from the dropdown." }, { status: 400 });
  }
  const manager = createDefaultLLMManager(async (ref) => (ref ? process.env[ref] : undefined));

  // Studio RAG: resolve deployment collection and retrieve context for user message
  const studioCollectionId = await getDeploymentCollectionId();
  const ragLimit = await getEffectiveRagRetrieveLimit({ type: "chat" });
  const ragChunks = studioCollectionId
    ? await retrieveChunks(studioCollectionId, userMessage, ragLimit)
    : [];
  const ragContext = ragChunks.length > 0 ? ragChunks.map((c) => c.text).join("\n\n") : undefined;

  // Load chat feedback for injection: by similarity when embedding available, else last N
  const { lastN, retrieveCap, minScore } = await getEffectiveFeedbackLimits({ type: "chat" });
  let feedbackItems: ReturnType<typeof fromFeedbackRow>[];
  const relevantFeedback = await getRelevantFeedbackForScope(
    "chat",
    "chat",
    userMessage,
    retrieveCap,
    minScore
  );
  if (relevantFeedback != null) {
    feedbackItems = relevantFeedback;
  } else {
    const fbRows = await db
      .select()
      .from(feedback)
      .where(eq(feedback.targetType, "chat"))
      .orderBy(desc(feedback.createdAt))
      .limit(lastN);
    feedbackItems = fbRows.map(fromFeedbackRow);
  }
  const feedbackInjection = buildFeedbackInjection(feedbackItems);

  // Load chat assistant settings (custom prompt, context selection, recent summaries count, history compression). Fallback to null if table missing.
  let chatSettings: {
    customSystemPrompt: string | null;
    contextAgentIds: string[] | null;
    contextWorkflowIds: string[] | null;
    contextToolIds: string[] | null;
    recentSummariesCount: number | null;
    temperature: number | null;
    historyCompressAfter: number | null;
    historyKeepRecent: number | null;
    plannerRecentMessages: number | null;
  } | null = null;
  try {
    const settingsRows = await db
      .select()
      .from(chatAssistantSettings)
      .where(eq(chatAssistantSettings.id, "default"));
    chatSettings = settingsRows.length > 0 ? fromChatAssistantSettingsRow(settingsRows[0]) : null;
  } catch {
    // Table may not exist yet (e.g. new deployment without migration)
  }
  const systemPromptOverride =
    chatSettings?.customSystemPrompt && chatSettings.customSystemPrompt.trim().length > 0
      ? chatSettings.customSystemPrompt.trim()
      : undefined;

  const chatTemperature = chatSettings?.temperature ?? 0.7;

  const recentSummariesCount = Math.min(
    MAX_SUMMARIES,
    Math.max(MIN_SUMMARIES, chatSettings?.recentSummariesCount ?? DEFAULT_RECENT_SUMMARIES_COUNT)
  );

  // Cross-chat context: stored preferences + recent conversation summaries
  let crossChatContext = "";
  try {
    const memoryRows = await db
      .select()
      .from(assistantMemory)
      .orderBy(asc(assistantMemory.createdAt));
    if (memoryRows.length > 0) {
      const prefs = memoryRows
        .map((r) => fromAssistantMemoryRow(r))
        .map((e) => (e.key ? `${e.key}: ${e.content}` : e.content))
        .join("\n");
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
      crossChatContext +=
        "Recent conversation summaries and last output (user may reference 'the output' or 'what you said last time'):\n";
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
          const tail = chronological
            .map((r) => `${r.role}: ${r.content.slice(0, 600)}${r.content.length > 600 ? "…" : ""}`)
            .join("\n  ");
          crossChatContext += `  Last messages:\n  ${tail}\n`;
        }
      }
    }
  } catch {
    // summary column may not exist yet
  }
  const crossChatContextTrimmed = crossChatContext.trim() || undefined;

  // Load studio context so the assistant knows available tools, agents, workflows, LLM providers, connectors
  await ensureStandardTools();
  const [agentRows, workflowRows, toolRows, llmRows, connectorRows] = await Promise.all([
    db.select().from(agents),
    db.select().from(workflows),
    db.select().from(tools),
    db.select().from(llmConfigs),
    db.select().from(ragConnectors),
  ]);
  const agentIds = chatSettings?.contextAgentIds;
  const workflowIds = chatSettings?.contextWorkflowIds;
  const toolIdsFilter = chatSettings?.contextToolIds;
  const safeToolRows = Array.isArray(toolRows) ? toolRows : [];
  const safeAgentRows = Array.isArray(agentRows) ? agentRows : [];
  const safeWorkflowRows = Array.isArray(workflowRows) ? workflowRows : [];
  const safeLlmRows = Array.isArray(llmRows) ? llmRows : [];
  const safeConnectorRows = Array.isArray(connectorRows) ? connectorRows : [];
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
    llmProviders: safeLlmRows
      .map(fromLlmConfigRow)
      .map((c) => ({ id: c.id, provider: c.provider, model: c.model })),
    connectors: studioContextConnectorsFromRows(safeConnectorRows),
  };

  // Load custom pricing overrides
  const pricingRows = await db.select().from(modelPricing);
  const customPricing: Record<string, { input: number; output: number }> = {};
  for (const r of pricingRows) {
    const p = fromModelPricingRow(r);
    customPricing[p.modelPattern] = {
      input: Number(p.inputCostPerM),
      output: Number(p.outputCostPerM),
    };
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
      const inputPreview =
        typeof lastUser?.content === "string"
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
        lastUserContent:
          typeof lastUser?.content === "string" ? lastUser.content.slice(0, 500) : undefined,
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
  const historyCompressAfter = Math.max(
    10,
    Math.min(200, chatSettings?.historyCompressAfter ?? DEFAULT_HISTORY_COMPRESS_AFTER)
  );
  const historyKeepRecent = Math.max(
    5,
    Math.min(100, chatSettings?.historyKeepRecent ?? DEFAULT_HISTORY_KEEP_RECENT)
  );
  const effectiveKeepRecent = Math.min(historyKeepRecent, historyCompressAfter - 1);
  if (history.length > historyCompressAfter) {
    try {
      const toSummarize = history.slice(0, history.length - effectiveKeepRecent);
      const summary = await summarizeHistoryChunk(
        toSummarize.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
        manager,
        llmConfig
      );
      history = [
        {
          role: "system" as const,
          content: `Earlier in this conversation (summarized):\n${summary}`,
        },
        ...history.slice(-effectiveKeepRecent),
      ];
    } catch {
      // If summarization fails, just trim to last N so we don't blow context
      history = history.slice(-effectiveKeepRecent);
    }
  }

  const executeTurnState: ExecuteTurnState = {
    conversationId,
    vaultKey,
    contentToStore,
    userMessage,
    isCredentialReply: !!isCredentialReply,
    credentialResponse,
    useHeapMode,
    bypassRunResponse: bypassRunResponse === true,
    runIdFromClient,
    didAutoForwardToRun,
    forwardedRunId,
    runWaitingContext,
    providerId,
    uiContext,
    attachedContext,
    conversationTitle,
    continueShellApproval,
    hasContinueShellApproval,
    chatSettings,
    studioContext,
    feedbackInjection,
    ragContext,
    manager,
    usageEntries,
    customPricing,
    llmConfig: llmConfig!,
    payload,
    request,
    existingRows,
    history,
    crossChatContextTrimmed,
    systemPromptOverride,
    chatTemperature,
    recentSummariesCount,
    confirmationPathMessage,
  };
  const executeTurn = async (writer?: { enqueue(d: object): void }, turnId?: string) => {
    return await executeTurnImpl(executeTurnState, writer, turnId);
  };

  const streamRequested =
    request.url.includes("stream=1") ||
    request.headers.get("accept")?.includes("text/event-stream");
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
        (t === "done"
          ? "Done"
          : t === "plan"
            ? "Plan"
            : t === "rephrased_prompt"
              ? "Rephrased prompt"
              : t === "error"
                ? "Error"
                : null);
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
        channelPublish(turnId, d as import("../../_lib/chat-event-channel").ChatChannelEvent);
        const dd = d as Record<string, unknown>;
        const tt = dd.type as string;
        // #region agent log
        if (tt === "trace_step" || tt === "step_start") {
          if (typeof fetch !== "undefined")
            fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e0760a" },
              body: JSON.stringify({
                sessionId: "e0760a",
                location: "chat/route.ts:enqueue",
                message: "publish event",
                data: { turnId, eventType: tt },
                hypothesisId: "H1",
                timestamp: Date.now(),
              }),
            }).catch(() => {});
        }
        // #endregion
        if (
          tt === "trace_step" ||
          tt === "step_start" ||
          tt === "todo_done" ||
          tt === "plan" ||
          tt === "done" ||
          tt === "error" ||
          tt === "rephrased_prompt"
        ) {
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
    await db
      .insert(conversationLocks)
      .values({ conversationId, startedAt: now, createdAt: now })
      .run();
    alreadyLocked = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/UNIQUE|unique|SqliteError.*primary/i.test(msg)) throw e;
  }
  return runSerializedByConversation(
    conversationId,
    async () => executeTurn(undefined, undefined),
    { alreadyLocked }
  ) as Promise<Response>;
}
