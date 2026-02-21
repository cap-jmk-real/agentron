import { json } from "../_lib/response";
import { logApiError } from "../_lib/api-logger";
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
} from "../_lib/db";
import { scheduleReminder, cancelReminderTimeout } from "../_lib/reminder-scheduler";
import { registerScheduledTurnRunner } from "../_lib/run-scheduled-turn";
import {
  runWorkflow,
  RUN_CANCELLED_MESSAGE,
  WAITING_FOR_USER_MESSAGE,
  WaitingForUserError,
} from "../_lib/run-workflow";
import { executeTool, enrichAgentToolResult, resolveTemplateVars } from "./_lib/execute-tool";
import { getFeedbackForScope } from "../_lib/feedback-for-scope";
import { getRelevantFeedbackForScope } from "../_lib/feedback-retrieval";
import { getEffectiveRagRetrieveLimit, getEffectiveFeedbackLimits } from "../_lib/rag-limits";
import { getRunForImprovement } from "../_lib/run-for-improvement";
import { enqueueWorkflowResume, processOneWorkflowJob } from "../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../_lib/rag";
import type { RemoteServer } from "../_lib/db";
import { testRemoteConnection } from "../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../_lib/naming";
import { runSerializedByConversation } from "../_lib/chat-queue";
import {
  publish as channelPublish,
  finish as channelFinish,
  setPendingJob,
  takePendingJob,
} from "../_lib/chat-event-channel";
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
import { getContainerManager, withContainerInstallHint } from "../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../_lib/credential-store";
import { getVaultKeyFromRequest } from "../_lib/vault";
import { loadSpecialistOverrides } from "../_lib/specialist-overrides";
import {
  createRunNotification,
  createChatNotification,
  clearActiveBySourceId,
} from "../_lib/notifications-store";
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
import {
  DEFAULT_RECENT_SUMMARIES_COUNT,
  MIN_SUMMARIES,
  MAX_SUMMARIES,
  LAST_MESSAGES_PER_RECENT_CHAT,
  pendingPlanByConversation,
  sanitizeDonePayload,
  buildRecentConversationContext,
} from "./_lib/chat-route-shared";
import { runChatPost } from "./_lib/chat-route-post";

export const runtime = "nodejs";

// Re-export for tests
export {
  extractContentFromRawResponse,
  IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE,
  AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION,
  AGENT_SPECIALIST_AGENTIC_BLOCKS,
} from "./_lib/chat-route-shared";

export async function POST(request: Request) {
  return runChatPost(request);
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
      const toolResults = msg.toolCalls.map((t) => ({
        name: t.name,
        args: t.arguments,
        result: t.result,
      }));
      const turnStatus = getTurnStatusFromToolResults(toolResults, { useLastAskUser: true });
      const planCall = msg.toolCalls.find((t) => t.name === "__plan__");
      const planArgs = (planCall?.arguments ?? {}) as {
        todos?: unknown;
        completedStepIndices?: unknown;
      };
      const todos = Array.isArray(planArgs.todos)
        ? planArgs.todos.filter((x): x is string => typeof x === "string")
        : undefined;
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
      .select({
        role: chatMessages.role,
        content: chatMessages.content,
        toolCalls: chatMessages.toolCalls,
      })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt));
    let history: LLMMessage[] = existingRows.map((r) => {
      const role = r.role as "user" | "assistant" | "system";
      let content = r.content ?? "";
      if (role === "assistant" && !content.trim() && r.toolCalls) {
        try {
          const parsed =
            typeof r.toolCalls === "string"
              ? (JSON.parse(r.toolCalls) as { name: string; result?: unknown }[])
              : undefined;
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
    const convRows = await db
      .select({
        lastUsedProvider: conversations.lastUsedProvider,
        lastUsedModel: conversations.lastUsedModel,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const conv = convRows[0];
    let llmConfig = conv?.lastUsedProvider
      ? configsWithSecret.find((c) => c.id === conv.lastUsedProvider)
      : undefined;
    if (!llmConfig) llmConfig = configsWithSecret[0];

    let chatSettings: {
      contextAgentIds: string[] | null;
      contextWorkflowIds: string[] | null;
      contextToolIds: string[] | null;
      temperature: number | null;
    } | null = null;
    try {
      const settingsRows = await db
        .select()
        .from(chatAssistantSettings)
        .where(eq(chatAssistantSettings.id, "default"));
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
      tools: (toolIdsFilter == null || toolIdsFilter.length === 0
        ? toolRows.map(fromToolRow)
        : toolRows.map(fromToolRow).filter((t) => toolIdsFilter!.includes(t.id))
      ).map((t) => ({ id: t.id, name: t.name, protocol: t.protocol })),
      agents: (agentIds == null || agentIds.length === 0
        ? agentRows.map(fromAgentRow)
        : agentRows.map(fromAgentRow).filter((a) => agentIds!.includes(a.id))
      ).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      workflows: (workflowIds == null || workflowIds.length === 0
        ? workflowRows.map(fromWorkflowRow)
        : workflowRows.map(fromWorkflowRow).filter((w) => workflowIds!.includes(w.id))
      ).map((w) => ({ id: w.id, name: w.name, executionMode: w.executionMode })),
      llmProviders: llmRows
        .map(fromLlmConfigRow)
        .map((c) => ({ id: c.id, provider: c.provider, model: c.model })),
    };

    const studioCollectionId = await getDeploymentCollectionId();
    const ragLimit = await getEffectiveRagRetrieveLimit({ type: "chat" });
    const ragChunks = studioCollectionId
      ? await retrieveChunks(studioCollectionId, userMessageContent, ragLimit)
      : [];
    const ragContext = ragChunks.length > 0 ? ragChunks.map((c) => c.text).join("\n\n") : undefined;

    const { lastN, retrieveCap, minScore } = await getEffectiveFeedbackLimits({ type: "chat" });
    let feedbackItems: ReturnType<typeof fromFeedbackRow>[];
    const relevantFeedback = await getRelevantFeedbackForScope(
      "chat",
      "chat",
      userMessageContent,
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

    const manager = createDefaultLLMManager(async (ref) => (ref ? process.env[ref] : undefined));
    const usageEntries: { response: LLMResponse }[] = [];
    const trackingCallLLM = async (req: LLMRequest): Promise<LLMResponse> => {
      const response = await manager.chat(llmConfig as LLMConfig, req, { source: "chat" });
      usageEntries.push({ response });
      return response;
    };

    const result = await runAssistant(history, userMessageContent.trim().slice(0, 2000), {
      callLLM: trackingCallLLM,
      executeTool: (name: string, args: Record<string, unknown>) =>
        executeTool(name, args, { conversationId, vaultKey: null }),
      feedbackInjection: feedbackInjection || undefined,
      ragContext,
      uiContext: getSystemContext(),
      studioContext,
      chatSelectedLlm: llmConfig
        ? { id: llmConfig.id, provider: llmConfig.provider, model: llmConfig.model }
        : undefined,
      temperature: chatTemperature,
      maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
    });

    const displayContent = getAssistantDisplayContent(result.content, result.toolResults);
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: displayContent || getAskUserQuestionFromToolResults(result.toolResults) || "",
      toolCalls:
        result.toolResults.length > 0
          ? result.toolResults.map((r) => ({
              id: crypto.randomUUID(),
              name: r.name,
              arguments: r.args,
              result: r.result,
            }))
          : undefined,
      llmTrace: undefined,
      createdAt: Date.now(),
      conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
    if (conversationId && hasWaitingForInputInToolResults(result.toolResults)) {
      await createChatNotification(conversationId);
    }
    await db
      .update(conversations)
      .set({ lastUsedProvider: llmConfig.provider, lastUsedModel: llmConfig.model })
      .where(eq(conversations.id, conversationId))
      .run();
    for (const entry of usageEntries) {
      const usage = entry.response.usage;
      if (usage && usage.totalTokens > 0) {
        const pricingRows = await db.select().from(modelPricing);
        const customPricing: Record<string, { input: number; output: number }> = {};
        for (const r of pricingRows) {
          const p = fromModelPricingRow(r);
          customPricing[p.modelPattern] = {
            input: Number(p.inputCostPerM),
            output: Number(p.outputCostPerM),
          };
        }
        const pricing = resolveModelPricing(llmConfig.model, customPricing);
        const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
        await db
          .insert(tokenUsage)
          .values(
            toTokenUsageRow({
              id: crypto.randomUUID(),
              provider: llmConfig.provider,
              model: llmConfig.model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              estimatedCost: cost != null ? String(cost) : null,
            })
          )
          .run();
      }
    }
  });
});
