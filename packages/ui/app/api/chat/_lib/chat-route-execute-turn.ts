/**
 * Execute-turn implementation for the chat POST route.
 * Extracted from chat-route-post.ts so the route file stays under 1000 lines.
 */
import { json } from "../../_lib/response";
import { logApiError } from "../../_lib/api-logger";
import {
  db,
  conversations,
  chatMessages,
  tokenUsage,
  toChatMessageRow,
  toTokenUsageRow,
} from "../../_lib/db";
import { eq, asc } from "drizzle-orm";
import type { LLMTraceCall, LLMConfig } from "@agentron-studio/core";
import type {
  LLMMessage,
  LLMResponse,
  LLMRequest,
  PlannerOutput,
  StudioContext,
} from "@agentron-studio/runtime";
import type { LLMManager } from "@agentron-studio/runtime";
import {
  runAssistant,
  getRegistry,
  resolveModelPricing,
  calculateCost,
  SYSTEM_PROMPT,
} from "@agentron-studio/runtime";
import { executeTool, enrichAgentToolResult } from "./execute-tool";
import {
  getAskUserQuestionFromToolResults,
  getAssistantDisplayContent,
  getTurnStatusFromToolResults,
  hasWaitingForInputInToolResults,
  normalizeChatError,
  hasFormatResponseWithContent,
  extractOptionsFromContentWithLLM,
  deriveInteractivePromptFromContentWithLLM,
  normalizeOptionCountInContent,
  normalizeAskUserOptionsInToolResults,
  mergeCreatedIdsIntoPlan,
} from "../../_lib/chat-helpers";
import {
  getSystemContext,
  rephraseAndClassify,
  buildContinueShellApprovalMessage,
  shouldSkipRephrase,
  generateConversationTitle,
  summarizeConversation,
} from "./run-turn-helpers";
import { createChatNotification } from "../../_lib/notifications-store";
import { finish as channelFinish } from "../../_lib/chat-event-channel";
import {
  pendingPlanByConversation,
  sanitizeDonePayload,
  buildRecentConversationContext,
  AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION,
} from "./chat-route-shared";
import { runHeapModeTurn } from "./chat-route-heap";
import { loadSpecialistOverrides } from "../../_lib/specialist-overrides";

/** Chat assistant settings shape (from db). */
export interface ExecuteTurnChatSettings {
  customSystemPrompt: string | null;
  contextAgentIds: string[] | null;
  contextWorkflowIds: string[] | null;
  contextToolIds: string[] | null;
  recentSummariesCount: number | null;
  temperature: number | null;
  historyCompressAfter: number | null;
  historyKeepRecent: number | null;
  plannerRecentMessages: number | null;
}

/** State passed into executeTurnImpl; built in chat-route-post after the setup block. */
export interface ExecuteTurnState {
  conversationId: string | undefined;
  vaultKey: Buffer | null;
  contentToStore: string;
  userMessage: string | undefined;
  isCredentialReply: boolean;
  credentialResponse: { credentialKey?: string; value?: string; save?: boolean } | undefined;
  useHeapMode: boolean;
  bypassRunResponse: boolean;
  runIdFromClient: string | undefined;
  didAutoForwardToRun: boolean;
  forwardedRunId: string | null;
  runWaitingContext: string | undefined;
  providerId: string | undefined;
  uiContext: string | undefined;
  attachedContext: string | undefined;
  conversationTitle: string | undefined;
  continueShellApproval:
    | { command?: string; stdout?: string; stderr?: string; exitCode?: number }
    | undefined;
  hasContinueShellApproval: boolean;
  chatSettings: ExecuteTurnChatSettings | null;
  studioContext: StudioContext;
  feedbackInjection: string;
  ragContext: string | undefined;
  manager: LLMManager;
  usageEntries: { response: LLMResponse }[];
  customPricing: Record<string, { input: number; output: number }>;
  llmConfig: LLMConfig & { id: string };
  payload: Record<string, unknown>;
  request: Request;
  existingRows: { role: string | null; content: string | null; toolCalls: string | null }[];
  history: LLMMessage[];
  crossChatContextTrimmed: string | undefined;
  systemPromptOverride: string | undefined;
  chatTemperature: number;
  recentSummariesCount: number;
  confirmationPathMessage: string | null;
}

const CHAT_ASSISTANT_MAX_TOKENS = 8192;

/**
 * Runs one chat turn (streaming or non-streaming). Caller builds ExecuteTurnState in chat-route-post
 * after the block that sets runWaitingContext, studio context, chatSettings, etc.
 */
export async function executeTurnImpl(
  state: ExecuteTurnState,
  writer?: { enqueue(d: object): void },
  turnId?: string
): Promise<Response | void> {
  const STOPPED_BY_USER = "Stopped by user";
  const LLM_TRACE_PREVIEW_MAX = 600;

  function createTrackingCallLLM(opts: {
    pushTrace?: (entry: LLMTraceCall) => void;
    enqueueTraceStep?: (step: {
      phase: string;
      label?: string;
      messageCount?: number;
      contentPreview?: string;
      inputPreview?: string;
      requestMessages?: Array<{ role: string; content: string }>;
      responseContent?: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      specialistId?: string;
    }) => void;
    signal?: AbortSignal | null;
    getExtraTraceData?: () => { specialistId?: string };
  }) {
    return async (req: LLMRequest) => {
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
      const response = await state.manager.chat(state.llmConfig as LLMConfig, req, {
        source: "chat",
      });
      state.usageEntries.push({ response });
      const contentStr = typeof response.content === "string" ? response.content : "";
      const outputPreview = contentStr.slice(0, LLM_TRACE_PREVIEW_MAX);
      opts.pushTrace?.({
        messageCount: req.messages.length,
        lastUserContent:
          typeof lastUser?.content === "string" ? lastUser.content.slice(0, 500) : undefined,
        requestMessages: requestMessagesForLog.slice(-6).map((m) => ({
          role: m.role,
          content: (typeof m.content === "string" ? m.content : String(m.content ?? "")).slice(
            0,
            800
          ),
        })),
        responseContent: contentStr.slice(0, 12000),
        responsePreview: contentStr.slice(0, 400),
        usage: response.usage,
      } as LLMTraceCall);
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

  if (writer != null && turnId != null) {
    const signal = state.request.signal;
    const throwIfAborted = () => {
      if (signal?.aborted) throw new Error(STOPPED_BY_USER);
    };
    const userMsg = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: state.contentToStore,
      createdAt: Date.now(),
      conversationId: state.conversationId!,
    };
    let generatedTitle: string | null = null;
    const llmTraceEntries: LLMTraceCall[] = [];
    let rephraseTraceEntry: LLMTraceCall | null = null;
    const enqueue = writer.enqueue;
    const currentSpecialistIdRef = { current: null as string | null };
    const streamTrackingCallLLM = createTrackingCallLLM({
      pushTrace: (e) => llmTraceEntries.push(e),
      enqueueTraceStep: (step) => enqueue({ type: "trace_step", ...step }),
      signal,
      getExtraTraceData: state.useHeapMode
        ? () => ({ specialistId: currentSpecialistIdRef.current ?? undefined })
        : undefined,
    });
    let doneSent = false;
    try {
      await db.insert(chatMessages).values(toChatMessageRow(userMsg)).run();
      throwIfAborted();

      if (state.didAutoForwardToRun && state.forwardedRunId) {
        const shortContent = `I've sent your reply to the run. The workflow is continuing. [View run](/runs/${state.forwardedRunId}).`;
        const assistantMsgShort = {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: shortContent,
          createdAt: Date.now(),
          conversationId: state.conversationId!,
        };
        doneSent = true;
        enqueue(
          sanitizeDonePayload({
            type: "done",
            content: shortContent,
            messageId: assistantMsgShort.id,
            userMessageId: userMsg.id,
            conversationId: state.conversationId,
          })
        );
        await db.insert(chatMessages).values(toChatMessageRow(assistantMsgShort)).run();
        return;
      }

      const userInputPreview = (state.userMessage ?? state.contentToStore ?? "")
        .trim()
        .slice(0, 500);
      if (userInputPreview) {
        enqueue({
          type: "trace_step",
          phase: "user_input",
          label: "User input",
          inputPreview: userInputPreview,
        });
      }

      if (state.existingRows.length === 0 && !state.isCredentialReply) {
        enqueue({ type: "trace_step", phase: "title", label: "Generating title…" });
        generatedTitle = await generateConversationTitle(
          (state.userMessage || state.contentToStore).trim().slice(0, 2000),
          state.manager,
          state.llmConfig
        );
        await db
          .update(conversations)
          .set({ ...(generatedTitle && { title: generatedTitle }) })
          .where(eq(conversations.id, state.conversationId!))
          .run();
        enqueue({ type: "trace_step", phase: "title_done", label: "Title set" });
      }
      throwIfAborted();

      // High-level context preparation step (history, feedback, knowledge, studio resources)
      enqueue({
        type: "trace_step",
        phase: "prepare",
        label: "Preparing context (history, knowledge, tools)…",
      });
      throwIfAborted();

      let effectiveMessage: string;
      let rephrasedPrompt: string | undefined;
      if (state.isCredentialReply && state.credentialResponse?.value) {
        effectiveMessage = state.credentialResponse.value.trim();
        rephrasedPrompt = undefined;
        enqueue({ type: "trace_step", phase: "rephrase_done", label: "Using provided credential" });
      } else if (state.hasContinueShellApproval && state.continueShellApproval) {
        effectiveMessage = buildContinueShellApprovalMessage({
          ...state.continueShellApproval,
          command: state.continueShellApproval.command ?? "",
        });
        rephrasedPrompt = undefined;
        enqueue({
          type: "trace_step",
          phase: "rephrase_done",
          label: "Continue from shell approval",
        });
      } else if (state.confirmationPathMessage) {
        effectiveMessage = state.confirmationPathMessage;
        rephrasedPrompt = undefined;
        enqueue({
          type: "trace_step",
          phase: "rephrase_done",
          label: "Deletions done, continuing",
        });
      } else if (shouldSkipRephrase(state.contentToStore, state.payload)) {
        effectiveMessage = (state.userMessage || state.contentToStore).trim().slice(0, 2000);
        rephrasedPrompt = undefined;
        enqueue({ type: "trace_step", phase: "rephrase_done", label: "Rephrase skipped" });
      } else {
        enqueue({ type: "trace_step", phase: "rephrase", label: "Rephrasing…" });
        const rephraseResult = await rephraseAndClassify(
          state.userMessage || state.contentToStore,
          state.manager,
          state.llmConfig,
          {
            onLlmCall: (e) => {
              rephraseTraceEntry = e;
            },
          }
        );
        throwIfAborted();
        enqueue({ type: "trace_step", phase: "rephrase_done", label: "Rephrase done" });
        rephrasedPrompt = rephraseResult.rephrasedPrompt;
        if (rephrasedPrompt != null) {
          enqueue({ type: "rephrased_prompt", rephrasedPrompt, label: "Rephrased prompt" });
        }
        const trimmed = (state.userMessage || state.contentToStore).trim().slice(0, 2000);
        effectiveMessage = rephrasedPrompt ?? trimmed;
        if (rephraseResult.wantsRetry) {
          const allRows = await db
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.conversationId, state.conversationId!))
            .orderBy(asc(chatMessages.createdAt));
          const lastUserMsg =
            [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
          if (lastUserMsg) effectiveMessage = lastUserMsg;
        }
      }
      throwIfAborted();

      const pendingPlan = state.conversationId
        ? pendingPlanByConversation.get(state.conversationId)
        : undefined;
      const result = state.useHeapMode
        ? await runHeapModeTurn({
            effectiveMessage,
            callLLM: streamTrackingCallLLM,
            executeToolCtx: {
              conversationId: state.conversationId,
              vaultKey: state.vaultKey,
              registry: getRegistry(loadSpecialistOverrides()),
            },
            registry: getRegistry(loadSpecialistOverrides()),
            manager: state.manager,
            llmConfig: state.llmConfig,
            pushUsage: (r) => state.usageEntries.push({ response: r }),
            enqueueTrace: (step) => enqueue({ type: "trace_step", ...step }),
            currentSpecialistIdRef,
            recentConversationContext: buildRecentConversationContext(
              state.history,
              state.chatSettings?.plannerRecentMessages ?? 12,
              {
                appendCurrentMessage: effectiveMessage,
              }
            ),
            runWaitingContext: state.runWaitingContext,
            pendingPlan: pendingPlan ?? undefined,
            feedbackInjection: state.feedbackInjection || undefined,
            ragContext: state.ragContext,
            uiContext: [state.uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
            studioContext: state.studioContext,
            systemPromptOverride: state.systemPromptOverride,
            temperature: state.chatTemperature,
            maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
          })
        : await runAssistant(state.history, effectiveMessage, {
            callLLM: streamTrackingCallLLM,
            executeTool: (toolName: string, toolArgs: Record<string, unknown>) =>
              executeTool(toolName, toolArgs, {
                conversationId: state.conversationId,
                vaultKey: state.vaultKey,
              }),
            feedbackInjection: state.feedbackInjection || undefined,
            ragContext: state.ragContext,
            uiContext: [state.uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
            attachedContext: state.attachedContext || undefined,
            studioContext: state.studioContext,
            crossChatContext: state.crossChatContextTrimmed,
            runWaitingContext: state.runWaitingContext,
            chatSelectedLlm: state.llmConfig
              ? {
                  id: state.llmConfig.id,
                  provider: state.llmConfig.provider,
                  model: state.llmConfig.model,
                }
              : undefined,
            systemPromptOverride:
              (state.systemPromptOverride ?? SYSTEM_PROMPT) +
              "\n\n" +
              AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION,
            temperature: state.chatTemperature,
            maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
            onProgress: {
              onPlan(reasoning, todos) {
                enqueue({ type: "plan", reasoning, todos });
              },
              onStepStart(stepIndex, todoLabel, toolName, subStepLabel) {
                enqueue({
                  type: "step_start",
                  stepIndex,
                  todoLabel,
                  toolName,
                  ...(subStepLabel != null && { subStepLabel }),
                });
              },
              onToolDone(index) {
                enqueue({ type: "todo_done", index });
              },
            },
          });

      // Update pending plan store for heap
      if (state.useHeapMode && state.conversationId) {
        if (
          hasWaitingForInputInToolResults(result.toolResults) &&
          "plan" in result &&
          result.plan
        ) {
          const planToStore = mergeCreatedIdsIntoPlan(
            result.plan as PlannerOutput,
            result.toolResults
          ) as PlannerOutput;
          pendingPlanByConversation.set(state.conversationId, planToStore);
        } else {
          pendingPlanByConversation.delete(state.conversationId);
        }
      }

      let toolResultsToUse = result.toolResults;
      const hasAskUser = toolResultsToUse.some(
        (r) => r.name === "ask_user" || r.name === "ask_credentials"
      );
      const hasFormatResponse = hasFormatResponseWithContent(toolResultsToUse);
      if (
        state.useHeapMode &&
        !hasAskUser &&
        !hasFormatResponse &&
        state.manager &&
        state.llmConfig &&
        (result.content ?? "").trim().length > 0
      ) {
        const callLLMForOptions = async (prompt: string) => {
          const res = await state.manager.chat(state.llmConfig as LLMConfig, {
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            maxTokens: 512,
          });
          return res.content ?? "";
        };
        const extracted = await extractOptionsFromContentWithLLM(result.content, callLLMForOptions);
        if (extracted && extracted.length >= 1) {
          toolResultsToUse = [
            ...toolResultsToUse,
            {
              name: "ask_user",
              args: {} as Record<string, unknown>,
              result: { question: "Please pick an option", options: extracted },
            },
          ];
        }
      }
      if (toolResultsToUse.length > 0 && state.manager && state.llmConfig) {
        toolResultsToUse = await normalizeAskUserOptionsInToolResults(
          toolResultsToUse,
          async (prompt: string) => {
            const res = await state.manager.chat(state.llmConfig as LLMConfig, {
              messages: [{ role: "user", content: prompt }],
              temperature: 0,
              maxTokens: 512,
            });
            return res.content ?? "";
          }
        );
      }

      const displayContentForOverride = getAssistantDisplayContent(
        result.content,
        toolResultsToUse
      );
      if (
        state.useHeapMode &&
        displayContentForOverride.length > 400 &&
        state.manager &&
        state.llmConfig
      ) {
        const firstAskUser = toolResultsToUse.find(
          (r) => r.name === "ask_user" || r.name === "ask_credentials"
        );
        if (firstAskUser?.result && typeof firstAskUser.result === "object") {
          const q = String((firstAskUser.result as { question?: string }).question ?? "").trim();
          const contentHasNextSteps = /\bnext steps?|pick one|choose one\b/i.test(
            displayContentForOverride
          );
          if (q && !/next steps?|pick one|choose one/i.test(q) && contentHasNextSteps) {
            const callLLMForDerive = async (prompt: string) => {
              const res = await state.manager.chat(state.llmConfig as LLMConfig, {
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
                maxTokens: 512,
              });
              return res.content ?? "";
            };
            const derived = await deriveInteractivePromptFromContentWithLLM(
              displayContentForOverride,
              callLLMForDerive
            );
            if (derived) {
              toolResultsToUse = toolResultsToUse.map((r) =>
                (r.name === "ask_user" || r.name === "ask_credentials") && r === firstAskUser
                  ? {
                      ...r,
                      result: {
                        ...(r.result as object),
                        waitingForUser: true,
                        question: derived.question,
                        options: derived.options,
                      },
                    }
                  : r
              );
            }
          }
        }
      }

      const planToolCall =
        result.reasoning || (result.todos && result.todos.length > 0)
          ? {
              id: crypto.randomUUID(),
              name: "__plan__",
              arguments: {
                ...(result.reasoning ? { reasoning: result.reasoning } : {}),
                ...(result.todos ? { todos: result.todos } : {}),
                ...(result.completedStepIndices
                  ? { completedStepIndices: result.completedStepIndices }
                  : {}),
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
      const fullLlmTrace = rephraseTraceEntry
        ? [rephraseTraceEntry, ...llmTraceEntries]
        : llmTraceEntries;
      let displayContent = getAssistantDisplayContent(result.content, toolResultsToUse);
      const turnStatus = getTurnStatusFromToolResults(
        toolResultsToUse,
        state.useHeapMode ? { useLastAskUser: true } : undefined
      );
      if (state.useHeapMode) {
        const lastAskUser = [...toolResultsToUse]
          .reverse()
          .find((r) => r.name === "ask_user" || r.name === "ask_credentials");
        const opts =
          lastAskUser?.result &&
          typeof lastAskUser.result === "object" &&
          Array.isArray((lastAskUser.result as { options?: unknown }).options)
            ? (lastAskUser.result as { options: unknown[] }).options.filter(
                (x): x is string => typeof x === "string" && x.trim().length > 0
              )
            : [];
        if (opts.length > 0) {
          displayContent = normalizeOptionCountInContent(displayContent, opts.length);
        }
      }
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
        conversationId: state.conversationId,
      };

      try {
        await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
        if (state.conversationId && hasWaitingForInputInToolResults(toolResultsToUse)) {
          await createChatNotification(state.conversationId);
        }
      } catch (insertErr: unknown) {
        const insertMsg = normalizeChatError(
          insertErr,
          state.llmConfig
            ? {
                provider: state.llmConfig.provider,
                model: state.llmConfig.model,
                endpoint: state.llmConfig.endpoint,
              }
            : undefined
        );
        enqueue({
          type: "error",
          error: insertMsg,
          errorCode: "CHAT_PERSIST_ERROR",
          messageId: assistantMsg.id,
          userMessageId: userMsg.id,
        });
        throw insertErr;
      }

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
          conversationId: state.conversationId,
          reasoning: result.reasoning,
          todos: result.todos,
          completedStepIndices: result.completedStepIndices,
          rephrasedPrompt,
          ...(generatedTitle && { conversationTitle: generatedTitle }),
          ...(state.useHeapMode &&
            "refinedTask" in result &&
            "priorityOrder" in result && {
              planSummary: {
                refinedTask: result.refinedTask as string,
                route: result.priorityOrder as (string | { parallel: string[] })[],
              },
            }),
        })
      );

      const msgCount = state.existingRows.length + 2;
      const convRows = await db
        .select({ summary: conversations.summary })
        .from(conversations)
        .where(eq(conversations.id, state.conversationId!));
      if (
        msgCount >= 6 &&
        convRows.length > 0 &&
        (convRows[0].summary == null || convRows[0].summary === "")
      ) {
        summarizeConversation(state.conversationId!, state.manager, state.llmConfig).catch(
          () => {}
        );
      }
      for (const entry of state.usageEntries) {
        const usage = entry.response.usage;
        if (usage && usage.totalTokens > 0) {
          const pricing = resolveModelPricing(state.llmConfig.model, state.customPricing);
          const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
          await db
            .insert(tokenUsage)
            .values(
              toTokenUsageRow({
                id: crypto.randomUUID(),
                provider: state.llmConfig.provider,
                model: state.llmConfig.model,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                estimatedCost: cost != null ? String(cost) : null,
              })
            )
            .run();
        }
      }
      await db
        .update(conversations)
        .set({
          lastUsedProvider: state.llmConfig.provider,
          lastUsedModel: state.llmConfig.model,
        })
        .where(eq(conversations.id, state.conversationId!))
        .run();
    } catch (err: unknown) {
      const msg = normalizeChatError(
        err,
        state.llmConfig
          ? {
              provider: state.llmConfig.provider,
              model: state.llmConfig.model,
              endpoint: state.llmConfig.endpoint,
            }
          : undefined
      );
      if (!doneSent) {
        const errorCode = "CHAT_TURN_ERROR";
        try {
          const assistantErrorMsg = {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: `Error: ${msg}`,
            createdAt: Date.now(),
            conversationId: state.conversationId,
          };
          await db.insert(chatMessages).values(toChatMessageRow(assistantErrorMsg)).run();
          enqueue({
            type: "error",
            error: msg,
            errorCode,
            messageId: assistantErrorMsg.id,
            userMessageId: userMsg.id,
          });
        } catch (persistErr) {
          enqueue({ type: "error", error: msg, errorCode: "CHAT_PERSIST_ERROR" });
        }
      }
    } finally {
      channelFinish(turnId);
    }
    return;
  }

  if (state.didAutoForwardToRun && state.forwardedRunId && state.conversationId) {
    const userMsgNonStream = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: state.contentToStore,
      createdAt: Date.now(),
      conversationId: state.conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(userMsgNonStream)).run();
    const shortContent = `I've sent your reply to the run. The workflow is continuing. [View run](/runs/${state.forwardedRunId}).`;
    const assistantMsgShort = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: shortContent,
      createdAt: Date.now(),
      conversationId: state.conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsgShort)).run();
    return json({
      content: shortContent,
      messageId: assistantMsgShort.id,
      userMessageId: userMsgNonStream.id,
      conversationId: state.conversationId,
    });
  }

  const userMsg = {
    id: crypto.randomUUID(),
    role: "user" as const,
    content: state.contentToStore,
    createdAt: Date.now(),
    conversationId: state.conversationId!,
  };
  await db.insert(chatMessages).values(toChatMessageRow(userMsg)).run();

  let generatedTitle: string | null = null;
  if (state.existingRows.length === 0 && !state.isCredentialReply) {
    generatedTitle = await generateConversationTitle(
      (state.userMessage || state.contentToStore).trim().slice(0, 2000),
      state.manager,
      state.llmConfig
    );
    await db
      .update(conversations)
      .set({ ...(generatedTitle && { title: generatedTitle }) })
      .where(eq(conversations.id, state.conversationId!))
      .run();
  }

  const llmTraceEntries: LLMTraceCall[] = [];
  let rephraseTraceEntry: LLMTraceCall | null = null;
  const trackingCallLLM = createTrackingCallLLM({ pushTrace: (e) => llmTraceEntries.push(e) });

  const trimmedForFallback = (state.userMessage || state.contentToStore).trim().slice(0, 2000);
  let rephrasedPrompt: string | undefined;
  let effectiveMessage: string;
  try {
    if (state.isCredentialReply && state.credentialResponse?.value) {
      effectiveMessage = state.credentialResponse.value.trim();
    } else if (state.hasContinueShellApproval && state.continueShellApproval) {
      effectiveMessage = buildContinueShellApprovalMessage({
        ...state.continueShellApproval,
        command: state.continueShellApproval.command ?? "",
      });
    } else if (state.confirmationPathMessage) {
      effectiveMessage = state.confirmationPathMessage;
    } else if (shouldSkipRephrase(state.contentToStore, state.payload)) {
      effectiveMessage = trimmedForFallback;
    } else {
      const rephraseResult = await rephraseAndClassify(
        state.userMessage || state.contentToStore,
        state.manager,
        state.llmConfig,
        {
          onLlmCall: (e) => {
            rephraseTraceEntry = e;
          },
        }
      );
      rephrasedPrompt = rephraseResult.rephrasedPrompt;
      effectiveMessage = rephraseResult.rephrasedPrompt ?? trimmedForFallback;
      if (rephraseResult.wantsRetry) {
        const allRows = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, state.conversationId!))
          .orderBy(asc(chatMessages.createdAt));
        const lastUserMsg = [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
        if (lastUserMsg) effectiveMessage = lastUserMsg;
      }
    }

    const pendingPlanNonStream = state.conversationId
      ? pendingPlanByConversation.get(state.conversationId)
      : undefined;
    const result = state.useHeapMode
      ? await runHeapModeTurn({
          effectiveMessage,
          callLLM: trackingCallLLM,
          executeToolCtx: {
            conversationId: state.conversationId,
            vaultKey: state.vaultKey,
            registry: getRegistry(loadSpecialistOverrides()),
          },
          registry: getRegistry(loadSpecialistOverrides()),
          manager: state.manager,
          llmConfig: state.llmConfig,
          pushUsage: (r) => state.usageEntries.push({ response: r }),
          recentConversationContext: buildRecentConversationContext(
            state.history,
            state.chatSettings?.plannerRecentMessages ?? 12,
            {
              appendCurrentMessage: effectiveMessage,
            }
          ),
          runWaitingContext: state.runWaitingContext,
          pendingPlan: pendingPlanNonStream ?? undefined,
          feedbackInjection: state.feedbackInjection || undefined,
          ragContext: state.ragContext,
          uiContext: [state.uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
          studioContext: state.studioContext,
          systemPromptOverride: state.systemPromptOverride,
          temperature: state.chatTemperature,
          maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
        })
      : await runAssistant(state.history, effectiveMessage, {
          callLLM: trackingCallLLM,
          executeTool: (toolName: string, toolArgs: Record<string, unknown>) =>
            executeTool(toolName, toolArgs, {
              conversationId: state.conversationId,
              vaultKey: state.vaultKey,
            }),
          feedbackInjection: state.feedbackInjection || undefined,
          ragContext: state.ragContext,
          uiContext: [state.uiContext, getSystemContext()].filter(Boolean).join("\n\n"),
          attachedContext: state.attachedContext || undefined,
          studioContext: state.studioContext,
          crossChatContext: state.crossChatContextTrimmed,
          runWaitingContext: state.runWaitingContext,
          chatSelectedLlm: state.llmConfig
            ? {
                id: state.llmConfig.id,
                provider: state.llmConfig.provider,
                model: state.llmConfig.model,
              }
            : undefined,
          systemPromptOverride:
            (state.systemPromptOverride ?? SYSTEM_PROMPT) +
            "\n\n" +
            AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION,
          temperature: state.chatTemperature,
          maxTokens: CHAT_ASSISTANT_MAX_TOKENS,
        });

    if (state.useHeapMode && state.conversationId) {
      if (hasWaitingForInputInToolResults(result.toolResults) && "plan" in result && result.plan) {
        const planToStore = mergeCreatedIdsIntoPlan(
          result.plan as PlannerOutput,
          result.toolResults
        ) as PlannerOutput;
        pendingPlanByConversation.set(state.conversationId, planToStore);
      } else {
        pendingPlanByConversation.delete(state.conversationId);
      }
    }

    let toolResultsToUse = result.toolResults;
    const hasAskUserNonStream = toolResultsToUse.some(
      (r) => r.name === "ask_user" || r.name === "ask_credentials"
    );
    const hasFormatResponseNonStream = hasFormatResponseWithContent(toolResultsToUse);
    if (
      state.useHeapMode &&
      !hasAskUserNonStream &&
      !hasFormatResponseNonStream &&
      state.manager &&
      state.llmConfig &&
      (result.content ?? "").trim().length > 0
    ) {
      const callLLMForOptions = async (prompt: string) => {
        const res = await state.manager.chat(state.llmConfig as LLMConfig, {
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          maxTokens: 512,
        });
        return res.content ?? "";
      };
      const extracted = await extractOptionsFromContentWithLLM(result.content, callLLMForOptions);
      if (extracted && extracted.length >= 1) {
        toolResultsToUse = [
          ...toolResultsToUse,
          {
            name: "ask_user",
            args: {} as Record<string, unknown>,
            result: { question: "Please pick an option", options: extracted },
          },
        ];
      }
    }
    if (toolResultsToUse.length > 0 && state.manager && state.llmConfig) {
      toolResultsToUse = await normalizeAskUserOptionsInToolResults(
        toolResultsToUse,
        async (prompt: string) => {
          const res = await state.manager.chat(state.llmConfig as LLMConfig, {
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            maxTokens: 512,
          });
          return res.content ?? "";
        }
      );
    }

    const displayContentForOverrideNonStream = getAssistantDisplayContent(
      result.content,
      toolResultsToUse
    );
    if (
      state.useHeapMode &&
      displayContentForOverrideNonStream.length > 400 &&
      state.manager &&
      state.llmConfig
    ) {
      const firstAskUserNonStream = toolResultsToUse.find(
        (r) => r.name === "ask_user" || r.name === "ask_credentials"
      );
      if (firstAskUserNonStream?.result && typeof firstAskUserNonStream.result === "object") {
        const qNonStream = String(
          (firstAskUserNonStream.result as { question?: string }).question ?? ""
        ).trim();
        const contentHasNextStepsNonStream = /\bnext steps?|pick one|choose one\b/i.test(
          displayContentForOverrideNonStream
        );
        if (
          qNonStream &&
          !/next steps?|pick one|choose one/i.test(qNonStream) &&
          contentHasNextStepsNonStream
        ) {
          const callLLMForDeriveNonStream = async (prompt: string) => {
            const res = await state.manager.chat(state.llmConfig as LLMConfig, {
              messages: [{ role: "user", content: prompt }],
              temperature: 0,
              maxTokens: 512,
            });
            return res.content ?? "";
          };
          const derivedNonStream = await deriveInteractivePromptFromContentWithLLM(
            displayContentForOverrideNonStream,
            callLLMForDeriveNonStream
          );
          if (derivedNonStream) {
            toolResultsToUse = toolResultsToUse.map((r) =>
              (r.name === "ask_user" || r.name === "ask_credentials") && r === firstAskUserNonStream
                ? {
                    ...r,
                    result: {
                      ...(r.result as object),
                      waitingForUser: true,
                      question: derivedNonStream.question,
                      options: derivedNonStream.options,
                    },
                  }
                : r
            );
          }
        }
      }
    }

    const planToolCall =
      result.reasoning || (result.todos && result.todos.length > 0)
        ? {
            id: crypto.randomUUID(),
            name: "__plan__",
            arguments: {
              ...(result.reasoning ? { reasoning: result.reasoning } : {}),
              ...(result.todos ? { todos: result.todos } : {}),
              ...(result.completedStepIndices
                ? { completedStepIndices: result.completedStepIndices }
                : {}),
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
    const fullLlmTrace = rephraseTraceEntry
      ? [rephraseTraceEntry, ...llmTraceEntries]
      : llmTraceEntries;
    const displayContent = getAssistantDisplayContent(result.content, toolResultsToUse);
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: displayContent || getAskUserQuestionFromToolResults(toolResultsToUse) || "",
      toolCalls: assistantToolCalls,
      llmTrace: fullLlmTrace.length > 0 ? fullLlmTrace : undefined,
      ...(rephrasedPrompt != null && rephrasedPrompt.trim() && { rephrasedPrompt }),
      createdAt: Date.now(),
      conversationId: state.conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
    if (state.conversationId && hasWaitingForInputInToolResults(toolResultsToUse)) {
      await createChatNotification(state.conversationId);
    }
    const msgCount = state.existingRows.length + 2;
    const convRowsForSummary = await db
      .select({ summary: conversations.summary })
      .from(conversations)
      .where(eq(conversations.id, state.conversationId!));
    if (
      msgCount >= 6 &&
      convRowsForSummary.length > 0 &&
      (convRowsForSummary[0].summary == null || convRowsForSummary[0].summary === "")
    ) {
      summarizeConversation(state.conversationId!, state.manager, state.llmConfig).catch(() => {});
    }

    for (const entry of state.usageEntries) {
      const usage = entry.response.usage;
      if (usage && usage.totalTokens > 0) {
        const pricing = resolveModelPricing(state.llmConfig.model, state.customPricing);
        const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
        await db
          .insert(tokenUsage)
          .values(
            toTokenUsageRow({
              id: crypto.randomUUID(),
              provider: state.llmConfig.provider,
              model: state.llmConfig.model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              estimatedCost: cost != null ? String(cost) : null,
            })
          )
          .run();
      }
    }

    await db
      .update(conversations)
      .set({
        lastUsedProvider: state.llmConfig.provider,
        lastUsedModel: state.llmConfig.model,
      })
      .where(eq(conversations.id, state.conversationId!))
      .run();

    return json({
      content: displayContent,
      toolResults: toolResultsToUse,
      messageId: assistantMsg.id,
      userMessageId: userMsg.id,
      conversationId: state.conversationId,
      reasoning: result.reasoning,
      todos: result.todos,
      completedStepIndices: result.completedStepIndices,
      rephrasedPrompt,
      ...(generatedTitle && { conversationTitle: generatedTitle }),
      ...(state.useHeapMode &&
        "refinedTask" in result &&
        "priorityOrder" in result && {
          planSummary: { refinedTask: result.refinedTask, route: result.priorityOrder },
        }),
    });
  } catch (err: unknown) {
    logApiError("/api/chat", "POST", err);
    const msg = normalizeChatError(
      err,
      state.llmConfig
        ? {
            provider: state.llmConfig.provider,
            model: state.llmConfig.model,
            endpoint: state.llmConfig.endpoint,
          }
        : undefined
    );
    return json({ error: msg }, { status: 500 });
  }
}
