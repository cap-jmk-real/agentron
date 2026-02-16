import { json } from "../_lib/response";
import { logApiError } from "../_lib/api-logger";
import {
  db, agents, workflows, tools, llmConfigs, executions, files, sandboxes, customFunctions, feedback, conversations, chatMessages, chatAssistantSettings, assistantMemory, fromChatAssistantSettingsRow, toChatAssistantSettingsRow, fromAssistantMemoryRow, toAssistantMemoryRow,
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
} from "../_lib/db";
import { scheduleReminder, cancelReminderTimeout } from "../_lib/reminder-scheduler";
import { registerScheduledTurnRunner } from "../_lib/run-scheduled-turn";
import { runWorkflow, runWorkflowForRun, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE, runWriteFile, runContainerBuild, runContainer, runContainerSession } from "../_lib/run-workflow";
import { enqueueWorkflowRun } from "../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../_lib/rag";
import type { RemoteServer } from "../_lib/db";
import { testRemoteConnection } from "../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../_lib/naming";
import { runSerializedByConversation } from "../_lib/chat-queue";
import { llmContextPrefix, normalizeChatError } from "../_lib/chat-helpers";
import { openclawSend, openclawHistory, openclawAbort } from "../_lib/openclaw-client";
import { eq, asc, desc, isNotNull, and, like, inArray } from "drizzle-orm";
import type { LLMTraceCall, LLMConfig } from "@agentron-studio/core";
import { runAssistant, buildFeedbackInjection, createDefaultLLMManager, resolveModelPricing, calculateCost, type StudioContext, searchWeb, fetchUrl, refinePrompt } from "@agentron-studio/runtime";
import { getContainerManager, withContainerInstallHint } from "../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../_lib/credential-store";
import { getVaultKeyFromRequest } from "../_lib/vault";
import type { LLMMessage, LLMRequest, LLMResponse } from "@agentron-studio/runtime";
import { layoutNodesByGraph } from "../../lib/canvas-layout";
import { runShellCommand } from "../_lib/shell-exec";
import { platform } from "node:os";

export const runtime = "nodejs";

/** Build system context so the assistant generates platform-appropriate shell commands. */
function getSystemContext(): string {
  const p = platform();
  if (p === "win32") {
    return "System: Windows. Shell commands run via PowerShell — use where.exe to find executables (e.g. where.exe podman, where.exe docker). Paths use backslashes.";
  }
  if (p === "darwin") {
    return "System: macOS. Shell commands run via sh — use Unix commands (e.g. which, ls, docker, podman).";
  }
  if (p === "linux") {
    return "System: Linux. Shell commands run via sh — use Unix commands (e.g. which, ls, docker, podman).";
  }
  return `System: ${p}. Shell commands run via sh (Unix-style) unless Windows.`;
}

/** Build a chat-friendly message from a run's output and logs. Surfaces agent narrative, errors, and next steps. */
function buildRunResponseForChat(
  run: { id: string; status: string; output?: unknown },
  logEntries: Array<{ level: string; message: string }>
): string {
  const lines: string[] = [];
  const out = run.output && typeof run.output === "object" && !Array.isArray(run.output) ? (run.output as Record<string, unknown>) : null;
  const runError = out?.error ?? (out?.errorDetails as { message?: string } | undefined)?.message;
  const agentOutput = out?.output;

  if (run.status === "failed" && runError) {
    lines.push(`**Run failed:** ${runError}`);
    if (out?.errorDetails && typeof out.errorDetails === "object" && (out.errorDetails as { stack?: string }).stack) {
      lines.push("");
      lines.push("```");
      lines.push((out.errorDetails as { stack: string }).stack);
      lines.push("```");
    }
  } else if (run.status === "cancelled") {
    lines.push("Run was cancelled.");
  } else if (agentOutput !== undefined) {
    const text = typeof agentOutput === "string" ? agentOutput : JSON.stringify(agentOutput, null, 2);
    lines.push(text);
  }

  const stderrEntries = logEntries.filter((e) => e.level === "stderr" && e.message.trim());
  const uniqueStderr = [...new Set(stderrEntries.map((e) => e.message.trim()))].filter((m) => /error|fail|invalid|improper/i.test(m));
  if (uniqueStderr.length > 0) {
    lines.push("");
    lines.push("**Container/execution errors:**");
    for (const msg of uniqueStderr.slice(0, 5)) {
      lines.push(`- ${msg}`);
    }
  }

  if (run.status === "waiting_for_user") {
    lines.push("");
    lines.push("▶ **The agent is waiting for your input.** Reply above to continue.");
  }

  lines.push("");
  lines.push(`[View full run](/runs/${run.id})`);
  return lines.join("\n");
}

type GraphNode = { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> };
type GraphEdge = { id: string; source: string; target: string };

/** Apply layered graph layout to nodes so chat-created agents have a nice arrangement (same as the Arrange button on the canvas). */
function applyAgentGraphLayout(graphNodes: GraphNode[], graphEdges: GraphEdge[]): GraphNode[] {
  if (graphNodes.length === 0) return graphNodes;
  return layoutNodesByGraph({
    items: graphNodes,
    getNodeId: (n) => n.id,
    edges: graphEdges,
    setPosition: (n, x, y) => ({ ...n, position: [x, y] }),
  });
}

/** Enrich agent tool results with tool names (id + name) so stack traces show which tools an agent has. */
async function enrichAgentToolResult(result: unknown, args?: Record<string, unknown>): Promise<unknown> {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return result;
  const obj = result as Record<string, unknown>;
  if (obj.error != null) return result;
  let ids: string[] = [];
  if (Array.isArray(obj.toolIds)) ids = (obj.toolIds as unknown[]).filter((x): x is string => typeof x === "string");
  const def = obj.definition;
  if (def != null && typeof def === "object" && !Array.isArray(def)) {
    const defObj = def as Record<string, unknown>;
    if (Array.isArray(defObj.toolIds)) ids = [...ids, ...(defObj.toolIds as unknown[]).filter((x): x is string => typeof x === "string")];
  }
  if (Array.isArray(args?.toolIds)) ids = [...ids, ...(args.toolIds as unknown[]).filter((x): x is string => typeof x === "string")];
  ids = [...new Set(ids)];
  if (ids.length === 0) return result;
  await ensureStandardTools();
  const rows = await db.select({ id: tools.id, name: tools.name }).from(tools).where(inArray(tools.id, ids));
  const toolList = rows.map((r) => ({ id: r.id, name: r.name }));
  return { ...obj, tools: toolList };
}

/** Apply common grammar/spacing fixes when the rephrase model echoes the user message. */
function applyRephraseFixes(text: string): string {
  return text
    .replace(/\bThenI\b/gi, "Then I")
    .replace(/\bthenI\b/gi, "then I")
    .replace(/\blinkedin\b/gi, "LinkedIn")
    .replace(/\bsales navigator\b/gi, "Sales Navigator");
}

/** First step: rephrase the user message into a clear prompt and detect if they want to retry the last message. */
async function rephraseAndClassify(
  userMessage: string,
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: { provider: string; model: string; endpoint?: string; apiKey?: string; apiKeyRef?: string; extra?: { apiKey?: string } },
  opts?: { onLlmCall?: (entry: LLMTraceCall) => void }
): Promise<{ rephrasedPrompt: string | undefined; wantsRetry: boolean }> {
  const trimmed = userMessage.trim().slice(0, 2000);
  if (!trimmed) return { rephrasedPrompt: undefined, wantsRetry: false };
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You rephrase the user's message into a clear version that captures their intent. You MUST fix every typo and grammar error in your output (e.g. "ThenI" -> "Then I", "linkedin" -> "LinkedIn", "fo" -> "for"). Your rephrased text must be different from the user's message where errors exist — do not copy the user's message unchanged. Use 1-3 sentences if needed.
CRITICAL: Preserve all IDs verbatim. Any UUID, hex id, or "id <value>" in the user message must be copied character-for-character — never abbreviate, shorten, or use ellipsis (e.g. never output "id 93f81c45-..." or "8394..."; output the full id).
Then say whether they are asking to RETRY or REDO their last message. Output exactly:
<rephrased>your corrected rephrased prompt here</rephrased>
<wants_retry>yes</wants_retry> or <wants_retry>no</wants_retry>`,
    },
    { role: "user", content: trimmed },
  ];
  try {
    const response = await manager.chat(llmConfig as LLMConfig, {
      messages,
      maxTokens: 280,
      temperature: 0.2,
    });
    opts?.onLlmCall?.({
      phase: "rephrase",
      messageCount: messages.length,
      lastUserContent: trimmed.slice(0, 500),
      requestMessages: messages.map((m) => ({ role: m.role, content: (typeof m.content === "string" ? m.content : "").slice(0, 800) })),
      responseContent: (response.content ?? "").slice(0, 2000),
      responsePreview: (response.content ?? "").slice(0, 400),
      usage: response.usage,
    });
    const raw = response.content?.trim() ?? "";
    const wantsRetry = /<wants_retry>\s*yes\s*<\/wants_retry>/i.test(raw);
    // Prefer content inside <rephrased>...</rephrased>; otherwise use the LLM response (strip wants_retry) so we show the model output, not the user input
    const rephrasedMatch = raw.match(/<rephrased>\s*([\s\S]*?)<\/rephrased>/i);
    let rephrasedPrompt: string;
    if (rephrasedMatch && rephrasedMatch[1].trim()) {
      rephrasedPrompt = rephrasedMatch[1].trim().slice(0, 800);
    } else if (raw) {
      const withoutWantsRetry = raw.replace(/\s*<wants_retry>[\s\S]*$/i, "").trim();
      rephrasedPrompt = withoutWantsRetry.slice(0, 800) || trimmed;
    } else {
      rephrasedPrompt = trimmed;
    }
    // If the model echoed the user message, apply common grammar/spacing fixes so "Rephrased" still shows corrections
    if (rephrasedPrompt === trimmed || rephrasedPrompt.toLowerCase() === trimmed.toLowerCase()) {
      rephrasedPrompt = applyRephraseFixes(trimmed);
    }
    return { rephrasedPrompt, wantsRetry };
  } catch {
    // LLM unreachable: do not show user's message as "rephrased"
    return { rephrasedPrompt: undefined, wantsRetry: false };
  }
}

/** Max length for "short message" skip-rephrase (avoid rephrase for "ok", "yes", "3", etc.). */
const SHORT_MESSAGE_SKIP_REPHRASE_LEN = 100;

/** Max chars for stdout/stderr in continueShellApproval effectiveMessage to keep context small. */
const CONTINUE_SHELL_OUTPUT_MAX_LEN = 500;

function buildContinueShellApprovalMessage(data: { command: string; stdout?: string; stderr?: string; exitCode?: number }): string {
  const trunc = (s: string) =>
    s.length <= CONTINUE_SHELL_OUTPUT_MAX_LEN ? s : s.slice(0, CONTINUE_SHELL_OUTPUT_MAX_LEN) + "…";
  const stdout = trunc((data.stdout ?? "").trim());
  const stderr = trunc((data.stderr ?? "").trim());
  const exitCode = data.exitCode ?? "";
  return `The user approved the shell command: \`${(data.command ?? "").trim()}\`. Result: exitCode=${exitCode}${stdout ? `, stdout: ${stdout}` : ""}${stderr ? `, stderr: ${stderr}` : ""}.`;
}

/** Whether to skip rephrase (synthetic messages, explicit flag, or short non-question) to save one LLM call. */
function shouldSkipRephrase(
  content: string,
  payload?: { skipRephrase?: boolean }
): boolean {
  if (payload?.skipRephrase === true) return true;
  const trimmed = content.trim();
  if (trimmed.startsWith("The user approved and ran:")) return true;
  if (trimmed.startsWith("Added ") && trimmed.includes("allowlist")) return true;
  if (trimmed.length > 0 && trimmed.length < SHORT_MESSAGE_SKIP_REPHRASE_LEN && !trimmed.endsWith("?")) return true;
  return false;
}

const TITLE_FALLBACK_MAX_LEN = 40;

/** Generate a short chat title from the first user message using the configured LLM. Falls back to truncated message if LLM fails or returns empty. */
async function generateConversationTitle(
  firstMessage: string,
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: { provider: string; model: string; endpoint?: string; apiKey?: string; apiKeyRef?: string; extra?: { apiKey?: string } }
): Promise<string | null> {
  const trimmed = firstMessage.trim();
  if (!trimmed) return null;
  const fallback = trimmed.slice(0, TITLE_FALLBACK_MAX_LEN).trim() + (trimmed.length > TITLE_FALLBACK_MAX_LEN ? "…" : "");
  try {
    const response = await manager.chat(llmConfig as LLMConfig, {
      messages: [
        { role: "system", content: "Generate a very short chat title (3–6 words) for the following user message. Reply with only the title, no quotes or punctuation." },
        { role: "user", content: trimmed.slice(0, 400) },
      ],
      maxTokens: 40,
      temperature: 0.3,
    });
    const title = response.content?.trim().replace(/^["']|["']$/g, "").slice(0, 80) || null;
    return title || fallback;
  } catch {
    return fallback;
  }
}

/** Generate and store a short summary for a conversation (fire-and-forget). */
async function summarizeConversation(
  convId: string,
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: { provider: string; model: string; endpoint?: string; apiKey?: string; apiKeyRef?: string; extra?: { apiKey?: string } }
): Promise<void> {
  try {
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, convId)).orderBy(asc(chatMessages.createdAt));
    const text = rows.map((r) => `${r.role}: ${r.content.slice(0, 300)}${r.content.length > 300 ? "…" : ""}`).join("\n");
    if (!text.trim()) return;
    const response = await manager.chat(llmConfig as LLMConfig, {
      messages: [
        { role: "system", content: "Summarize this chat in 2–3 short sentences. Include: (1) what the user asked, (2) what the assistant did or produced (e.g. created agents/workflows, gave code, suggested changes) so the user can refer to 'the output' or 'what you said' later. No preamble." },
        { role: "user", content: text.slice(0, 4000) },
      ],
      maxTokens: 150,
      temperature: 0.2,
    });
    const summary = response.content?.trim().slice(0, 500) || null;
    if (summary) {
      await db.update(conversations).set({ summary }).where(eq(conversations.id, convId)).run();
    }
  } catch {
    // ignore
  }
}

/** Compress long conversation history by summarizing older messages so context stays within limits while preserving what happened. */
const DEFAULT_HISTORY_COMPRESS_AFTER = 24;
const DEFAULT_HISTORY_KEEP_RECENT = 16;
/** Max completion tokens for chat assistant so long tool calls (e.g. execute_code with large commands) are not truncated. */
const CHAT_ASSISTANT_MAX_TOKENS = 16384;

async function summarizeHistoryChunk(
  messages: { role: string; content: string }[],
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: { provider: string; model: string; endpoint?: string; apiKey?: string; apiKeyRef?: string; extra?: { apiKey?: string } }
): Promise<string> {
  if (messages.length === 0) return "";
  const text = messages.map((m) => `${m.role}: ${m.content.slice(0, 400)}${m.content.length > 400 ? "…" : ""}`).join("\n");
  const response = await manager.chat(llmConfig as LLMConfig, {
    messages: [
      { role: "system", content: "Summarize this conversation segment in 3–5 short sentences. Include: what the user asked or said, what the assistant did (created/updated agents, workflows, tools; answered questions; asked for confirmation). Preserve decisions and IDs if mentioned (e.g. 'user chose OpenAI', 'workflow X was created'). No preamble." },
      { role: "user", content: text.slice(0, 6000) },
    ],
    maxTokens: 300,
    temperature: 0.2,
  });
  return response.content?.trim().slice(0, 800) || "Earlier messages in this conversation.";
}

/** Ensure every llm node in graphNodes has a non-empty parameters.systemPrompt; fill from fallback when missing so agent behavior is defined. */
function ensureLlmNodesHaveSystemPrompt(
  graphNodes: { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[],
  fallback: string | undefined
): void {
  const defaultPrompt = "You are a helpful assistant. Follow the user's instructions and respond clearly.";
  const prompt = (typeof fallback === "string" && fallback.trim()) ? fallback.trim() : defaultPrompt;
  for (const node of graphNodes) {
    if (node.type !== "llm") continue;
    if (!node.parameters || typeof node.parameters !== "object") node.parameters = {};
    const current = node.parameters.systemPrompt;
    if (typeof current !== "string" || !current.trim()) {
      node.parameters.systemPrompt = prompt;
    }
  }
}

/** When toolIds are provided but graphNodes lack tool nodes, add tool nodes and edges from each llm node to each tool. */
function ensureToolNodesInGraph(
  graphNodes: { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[],
  graphEdges: { id: string; source: string; target: string }[],
  toolIds: string[]
): void {
  if (!Array.isArray(toolIds) || toolIds.length === 0) return;
  const existingToolIds = new Set(
    graphNodes
      .filter((n) => n.type === "tool" && n.parameters && typeof (n.parameters as { toolId?: string }).toolId === "string")
      .map((n) => (n.parameters as { toolId: string }).toolId)
  );
  const missingIds = toolIds.filter((id) => !existingToolIds.has(id));
  if (missingIds.length === 0) return;

  const llmNodes = graphNodes.filter((n) => n.type === "llm");
  const baseX = Math.max(...graphNodes.map((n) => n.position[0] ?? 0), 100) + 180;
  const edgeSet = new Set(graphEdges.map((e) => `${e.source}->${e.target}`));

  for (let i = 0; i < missingIds.length; i++) {
    const toolId = missingIds[i];
    const nodeId = `t-${toolId.slice(0, 8)}`;
    const pos: [number, number] = [baseX + i * 180, 100];
    graphNodes.push({ id: nodeId, type: "tool", position: pos, parameters: { toolId } });

    for (const llm of llmNodes) {
      const key = `${llm.id}->${nodeId}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        graphEdges.push({ id: `e-${llm.id}-${nodeId}`, source: llm.id, target: nodeId });
      }
    }
  }
}

const DEFAULT_MAX_DERIVED_GOOD = 20;
const DEFAULT_MAX_DERIVED_BAD = 20;
const DEFAULT_MIN_COMBINED_FEEDBACK = 1;
const DEFAULT_RECENT_EXECUTIONS_LIMIT = 50;

export type AgentLearningConfig = {
  maxDerivedGood?: number;
  maxDerivedBad?: number;
  minCombinedFeedback?: number;
  recentExecutionsLimit?: number;
};

function resolveLearningConfig(
  agentDefinition: Record<string, unknown> | undefined,
  toolArgs: { maxDerivedGood?: number; maxDerivedBad?: number; minCombinedFeedback?: number; recentExecutionsLimit?: number }
): Required<AgentLearningConfig> {
  const fromAgent = (agentDefinition?.learningConfig != null && typeof agentDefinition.learningConfig === "object" && !Array.isArray(agentDefinition.learningConfig))
    ? (agentDefinition.learningConfig as AgentLearningConfig)
    : {};
  return {
    maxDerivedGood: toolArgs.maxDerivedGood ?? fromAgent.maxDerivedGood ?? DEFAULT_MAX_DERIVED_GOOD,
    maxDerivedBad: toolArgs.maxDerivedBad ?? fromAgent.maxDerivedBad ?? DEFAULT_MAX_DERIVED_BAD,
    minCombinedFeedback: toolArgs.minCombinedFeedback ?? fromAgent.minCombinedFeedback ?? DEFAULT_MIN_COMBINED_FEEDBACK,
    recentExecutionsLimit: toolArgs.recentExecutionsLimit ?? fromAgent.recentExecutionsLimit ?? DEFAULT_RECENT_EXECUTIONS_LIMIT,
  };
}

type TrailStep = { agentId?: string; input?: unknown; output?: unknown; error?: string };

/** Derive feedback-like items from workflow execution history for an agent. Used for self-learning from errors and successes in a loop. */
async function deriveFeedbackFromExecutionHistory(
  agentId: string,
  options: { maxDerivedGood: number; maxDerivedBad: number; recentExecutionsLimit: number }
): Promise<import("@agentron-studio/core").Feedback[]> {
  const { maxDerivedGood, maxDerivedBad, recentExecutionsLimit } = options;
  const wfRows = await db.select({ id: workflows.id, nodes: workflows.nodes }).from(workflows);
  const workflowIds = new Set<string>();
  for (const row of wfRows) {
    let nodes: Array<{ config?: { agentId?: string } }> = [];
    if (row.nodes != null) {
      if (typeof row.nodes === "string") {
        try {
          nodes = JSON.parse(row.nodes) as Array<{ config?: { agentId?: string } }>;
        } catch {
          nodes = [];
        }
      } else if (Array.isArray(row.nodes)) {
        nodes = row.nodes as Array<{ config?: { agentId?: string } }>;
      }
    }
    for (const n of nodes) {
      if (n?.config && (n.config as { agentId?: string }).agentId === agentId) {
        workflowIds.add(row.id);
        break;
      }
    }
  }
  if (workflowIds.size === 0) return [];

  const execRows = await db
    .select()
    .from(executions)
    .where(and(eq(executions.targetType, "workflow"), inArray(executions.targetId, [...workflowIds])))
    .orderBy(desc(executions.startedAt))
    .limit(recentExecutionsLimit);

  const derived: import("@agentron-studio/core").Feedback[] = [];
  let goodCount = 0;
  let badCount = 0;

  for (const row of execRows) {
    const run = fromExecutionRow(row);
    const out = run.output && typeof run.output === "object" && !Array.isArray(run.output) ? (run.output as Record<string, unknown>) : null;
    const trail = Array.isArray(out?.trail) ? (out.trail as TrailStep[]) : [];

    if (run.status === "failed" && out && (out.error || (out as { success?: boolean }).success === false)) {
      const errMsg = typeof out.error === "string" ? out.error : "Run failed";
      const lastStep = trail.filter((s) => s.agentId === agentId).pop();
      if (badCount < maxDerivedBad) {
        derived.push({
          id: `derived-${run.id}-run`,
          targetType: "agent",
          targetId: agentId,
          executionId: run.id,
          input: lastStep?.input ?? run.targetId,
          output: errMsg,
          label: "bad",
          notes: "From failed run",
          createdAt: run.startedAt ?? Date.now(),
        });
        badCount++;
      }
    }

    for (const step of trail) {
      if (step.agentId !== agentId) continue;
      if (step.error != null && String(step.error).trim()) {
        if (badCount < maxDerivedBad) {
          derived.push({
            id: `derived-${run.id}-${step.input}-err`,
            targetType: "agent",
            targetId: agentId,
            executionId: run.id,
            input: step.input,
            output: step.error,
            label: "bad",
            notes: "From step error",
            createdAt: run.startedAt ?? Date.now(),
          });
          badCount++;
        }
      } else if (step.input !== undefined || step.output !== undefined) {
        if (goodCount < maxDerivedGood) {
          derived.push({
            id: `derived-${run.id}-${goodCount}`,
            targetType: "agent",
            targetId: agentId,
            executionId: run.id,
            input: step.input,
            output: step.output,
            label: "good",
            createdAt: run.startedAt ?? Date.now(),
          });
          goodCount++;
        }
      }
    }
  }

  return derived;
}

/** When the assistant only called ask_user (no other text), use the question as the chat response. */
/** When format_response was used, prefer its summary + needsInput as the stored content. */
/** When answer_question was used and the assistant produced substantial content (e.g. full explanation), prefer that content so guidance is surfaced to the user. */
function getAssistantDisplayContent(
  content: string,
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[]
): string {
  const formatResp = toolResults.find((r) => r.name === "format_response");
  const res = formatResp?.result;
  const usedAnswerQuestion = toolResults.some((r) => r.name === "answer_question");
  const contentTrimmed = content.trim();

  if (res && typeof res === "object" && res !== null && "formatted" in res && (res as { formatted?: boolean }).formatted === true) {
    const obj = res as { summary?: string; needsInput?: string };
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const needsInput = typeof obj.needsInput === "string" ? obj.needsInput.trim() : "";
    // If the user asked for explanation/advice (answer_question) and the assistant produced substantial text, show that so the full guidance is visible.
    if (usedAnswerQuestion && contentTrimmed.length > 150 && contentTrimmed.length > summary.length) {
      return needsInput ? `${contentTrimmed}\n\n${needsInput}` : contentTrimmed;
    }
    if (summary) return needsInput ? `${summary}\n\n${needsInput}` : summary;
  }
  if (contentTrimmed) return content;
  const q = getAskUserQuestionFromToolResults(toolResults);
  return q ?? content;
}

/** Derive turn status and interactive prompt from tool results for done event. */
function getTurnStatusFromToolResults(
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[]
): { status: "completed" | "waiting_for_input"; interactivePrompt?: { question: string; options?: string[] } } {
  const askUser = toolResults.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
  const askRes = askUser?.result;
  if (askRes && typeof askRes === "object" && askRes !== null) {
    const obj = askRes as { waitingForUser?: boolean; question?: string; options?: unknown[] };
    if (obj.waitingForUser === true) {
      const question = typeof obj.question === "string" ? obj.question.trim() : "Please provide the information or confirmation.";
      const options = Array.isArray(obj.options)
        ? obj.options.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
        : undefined;
      return { status: "waiting_for_input", interactivePrompt: { question, options } };
    }
  }
  const formatResp = toolResults.find((r) => r.name === "format_response");
  const fmtRes = formatResp?.result;
  if (fmtRes && typeof fmtRes === "object" && fmtRes !== null) {
    const obj = fmtRes as { formatted?: boolean; summary?: string; needsInput?: string; options?: unknown[] };
    if (obj.formatted === true) {
      const hasOptions = Array.isArray(obj.options) && obj.options.length > 0;
      const hasNeedsInput = typeof obj.needsInput === "string" && obj.needsInput.trim().length > 0;
      if (hasOptions || hasNeedsInput) {
        const options = hasOptions
          ? (obj.options as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
          : [];
        const question = [obj.summary, obj.needsInput].filter(Boolean).join("\n\n").trim() || "Choose an option:";
        return { status: "waiting_for_input", interactivePrompt: { question, options } };
      }
    }
  }
  return { status: "completed" };
}

/** Extract ask_user question from tool results or persisted toolCalls so history retains context. */
function getAskUserQuestionFromToolResults(
  toolResults: { name: string; result?: unknown }[] | undefined
): string | undefined {
  if (!Array.isArray(toolResults)) return undefined;
  const askUser = toolResults.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
  const res = askUser?.result;
  if (res && typeof res === "object" && res !== null && "question" in res && typeof (res as { question: unknown }).question === "string") {
    const q = (res as { question: string }).question.trim();
    return q || undefined;
  }
  return undefined;
}

type LastAssistantDeleteConfirmContext = {
  agentIds: string[];
  workflowIds: string[];
  firstOption: string;
};

/**
 * If the last message in the conversation is an assistant message whose tool results include
 * list_agents, list_workflows, and ask_user (with options), return the ids and first option
 * so we can run deletions server-side when the user confirms with the first option.
 */
function getLastAssistantDeleteConfirmContext(
  lastRow: { role: string; toolCalls?: string | null } | undefined
): LastAssistantDeleteConfirmContext | null {
  if (!lastRow || lastRow.role !== "assistant" || !lastRow.toolCalls) return null;
  let parsed: unknown;
  try {
    parsed = typeof lastRow.toolCalls === "string" ? JSON.parse(lastRow.toolCalls) : null;
  } catch {
    return null;
  }
  const toolResults = Array.isArray(parsed) ? (parsed as { name: string; result?: unknown }[]) : [];
  const listAgents = toolResults.find((r) => r.name === "list_agents");
  const listWorkflows = toolResults.find((r) => r.name === "list_workflows");
  const askUser = toolResults.find((r) => r.name === "ask_user");
  const agentIds = Array.isArray(listAgents?.result)
    ? (listAgents.result as { id?: string }[]).map((x) => x.id).filter((id): id is string => typeof id === "string")
    : [];
  const workflowIds = Array.isArray(listWorkflows?.result)
    ? (listWorkflows.result as { id?: string }[]).map((x) => x.id).filter((id): id is string => typeof id === "string")
    : [];
  const options =
    askUser?.result && typeof askUser.result === "object" && askUser.result !== null && "options" in askUser.result
      ? Array.isArray((askUser.result as { options?: unknown }).options)
        ? ((askUser.result as { options: unknown[] }).options.filter((o): o is string => typeof o === "string") as string[])
        : []
      : [];
  const firstOption = options[0]?.trim();
  if (!firstOption || (agentIds.length === 0 && workflowIds.length === 0)) return null;
  return { agentIds, workflowIds, firstOption };
}

/** True if the user message matches the first (affirmative) option, so we can run the confirmation path. */
function userMessageMatchesFirstOption(userTrim: string, firstOption: string): boolean {
  return userTrim === firstOption || userTrim.toLowerCase() === firstOption.toLowerCase();
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: { conversationId?: string; vaultKey?: Buffer | null }
): Promise<unknown> {
  try {
    const a = args != null && typeof args === "object" && !Array.isArray(args) ? args : {};
    const conversationId = ctx?.conversationId;
    const vaultKey = ctx?.vaultKey ?? null;

    if (name === "std-write-file") {
      return runWriteFile(args, conversationId ?? "chat");
    }
    if (name === "std-container-build") {
      return runContainerBuild(args);
    }
    if (name === "std-container-run") {
      return runContainer(args);
    }
    if (name === "std-container-session") {
      return runContainerSession(conversationId ?? "chat", args);
    }

    switch (name) {
    case "ask_user": {
      const question = typeof a.question === "string" ? a.question.trim() : "";
      const reason = typeof a.reason === "string" ? (a.reason as string).trim() : undefined;
      const options = Array.isArray(a.options)
        ? (a.options as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
        : undefined;
      return {
        waitingForUser: true,
        question: question || "Please provide the information or confirmation.",
        ...(options && options.length > 0 ? { options } : {}),
        ...(reason ? { reason } : {}),
      };
    }
    case "ask_credentials": {
      const question = typeof a.question === "string" ? a.question.trim() : "Please enter the requested credential.";
      const credentialKey = typeof a.credentialKey === "string" ? (a.credentialKey as string).trim().toLowerCase().replace(/\s+/g, "_") : "";
      if (!credentialKey) return { waitingForUser: true, credentialRequest: true, question: "Please provide a credential key.", credentialKey: "credential" };
      const plaintext = await getStoredCredential(credentialKey, vaultKey);
      if (plaintext != null && plaintext !== "") {
        return { credentialProvided: true, value: plaintext };
      }
      return { waitingForUser: true, credentialRequest: true, question: question || "Please enter the requested credential.", credentialKey };
    }
    case "format_response": {
      const summary = typeof a.summary === "string" ? (a.summary as string).trim() : "";
      const needsInput = typeof a.needsInput === "string" && (a.needsInput as string).trim()
        ? (a.needsInput as string).trim()
        : undefined;
      const options = Array.isArray(a.options)
        ? (a.options as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
        : undefined;
      return { formatted: true, summary: summary || "", needsInput, options };
    }
    case "retry_last_message": {
      if (!conversationId) return { lastUserMessage: null, message: "No conversation context." };
      const allRows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(asc(chatMessages.createdAt));
      const lastUserMsg = [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
      if (!lastUserMsg) return { lastUserMessage: null, message: "No previous user message in this conversation." };
      return { lastUserMessage: lastUserMsg, message: "Use this as the message to respond to. Reply to it now in your response." };
    }
    case "list_agents": {
      const rows = await db.select().from(agents);
      return rows.map(fromAgentRow).map((a) => ({ id: a.id, name: a.name, kind: a.kind, protocol: a.protocol }));
    }
    case "list_llm_providers": {
      const rows = await db.select().from(llmConfigs);
      return rows.map(fromLlmConfigRow).map((c) => ({ id: c.id, provider: c.provider, model: c.model }));
    }
    case "create_agent": {
      const id = crypto.randomUUID();
      const agentName = (a.name && String(a.name).trim()) ? (a.name as string) : randomAgentName();
      let toolIds = Array.isArray(a.toolIds) ? (a.toolIds as string[]).filter((x) => typeof x === "string") : undefined;
      const def: Record<string, unknown> = {};
      const topLevelSystemPrompt = typeof a.systemPrompt === "string" && a.systemPrompt.trim() ? (a.systemPrompt as string).trim() : undefined;
      if (topLevelSystemPrompt) def.systemPrompt = topLevelSystemPrompt;
      if (Array.isArray(a.graphNodes) && a.graphNodes.length > 0) {
        const graphNodes = a.graphNodes as { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[];
        const graphEdges = (Array.isArray(a.graphEdges) ? a.graphEdges : []) as { id: string; source: string; target: string }[];
        ensureLlmNodesHaveSystemPrompt(graphNodes, topLevelSystemPrompt ?? (def.systemPrompt as string | undefined));
        if (!toolIds || toolIds.length === 0) {
          const fromGraph = graphNodes
            .filter((n) => n.type === "tool" && n.parameters && typeof (n.parameters as { toolId?: string }).toolId === "string")
            .map((n) => (n.parameters as { toolId: string }).toolId);
          if (fromGraph.length > 0) toolIds = [...new Set(fromGraph)];
        }
        ensureToolNodesInGraph(graphNodes, graphEdges, toolIds ?? []);
        def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
      } else if (topLevelSystemPrompt && (a.kind as string) !== "code") {
        const nid = `n-${crypto.randomUUID().slice(0, 8)}`;
        const graphNodes: { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[] = [
          { id: nid, type: "llm", position: [100, 100], parameters: { systemPrompt: topLevelSystemPrompt } },
        ];
        const graphEdges: { id: string; source: string; target: string }[] = [];
        ensureToolNodesInGraph(graphNodes, graphEdges, toolIds ?? []);
        def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
      }
      if (toolIds && toolIds.length > 0) def.toolIds = toolIds;
      const llmConfigId = a.llmConfigId as string | undefined;
      if (llmConfigId) def.defaultLlmConfigId = llmConfigId;
      let llmConfig: { provider: string; model: string; endpoint?: string } | undefined;
      if (llmConfigId) {
        const llmRows = await db.select().from(llmConfigs).where(eq(llmConfigs.id, llmConfigId));
        if (llmRows.length > 0) {
          const c = fromLlmConfigRow(llmRows[0]);
          llmConfig = { provider: c.provider, model: c.model, endpoint: c.endpoint };
        }
      }
      const hasDef = "systemPrompt" in def || "graph" in def || "toolIds" in def || "defaultLlmConfigId" in def;
      const agent = {
        id,
        name: agentName,
        kind: (a.kind as string) || "node",
        type: "internal" as const,
        protocol: (a.protocol as string) || "native",
        description: (a.description as string) || undefined,
        capabilities: [],
        scopes: [],
        llmConfig,
        definition: hasDef ? def : undefined,
      };
      await db.insert(agents).values(toAgentRow(agent as import("@agentron-studio/core").Agent)).run();
      return { id, name: agent.name, message: `Agent "${agent.name}" created`, toolIds: toolIds?.length, llmConfig: !!llmConfig };
    }
    case "get_agent": {
      const agentId = a.id as string;
      const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
      if (agentRows.length === 0) return { error: "Agent not found" };
      return fromAgentRow(agentRows[0]);
    }
    case "update_agent": {
      const id = a.id as string;
      const rows = await db.select().from(agents).where(eq(agents.id, id));
      if (rows.length === 0) return { error: "Agent not found" };
      const existing = fromAgentRow(rows[0]);
      const updated = { ...existing };
      if (a.name) updated.name = a.name as string;
      if (a.description !== undefined) updated.description = a.description as string;
      const llmConfigId = a.llmConfigId as string | undefined;
      if (llmConfigId) {
        const llmRows = await db.select().from(llmConfigs).where(eq(llmConfigs.id, llmConfigId));
        if (llmRows.length > 0) {
          const c = fromLlmConfigRow(llmRows[0]);
          updated.llmConfig = { provider: c.provider, model: c.model, endpoint: c.endpoint };
        }
      }
      const rawDef = (updated as { definition?: unknown }).definition;
      const def: Record<string, unknown> =
        rawDef != null && typeof rawDef === "object" && !Array.isArray(rawDef) ? (rawDef as Record<string, unknown>) : {};
      if (a.systemPrompt !== undefined) def.systemPrompt = a.systemPrompt;
      if (Array.isArray(a.toolIds)) def.toolIds = (a.toolIds as string[]).filter((x) => typeof x === "string");
      if (a.llmConfigId) def.defaultLlmConfigId = a.llmConfigId as string;
      if (a.learningConfig != null && typeof a.learningConfig === "object" && !Array.isArray(a.learningConfig)) {
        const incoming = a.learningConfig as AgentLearningConfig;
        const existing = (def.learningConfig != null && typeof def.learningConfig === "object" && !Array.isArray(def.learningConfig))
          ? (def.learningConfig as AgentLearningConfig)
          : {};
        def.learningConfig = {
          ...existing,
          ...(incoming.maxDerivedGood !== undefined && { maxDerivedGood: incoming.maxDerivedGood }),
          ...(incoming.maxDerivedBad !== undefined && { maxDerivedBad: incoming.maxDerivedBad }),
          ...(incoming.minCombinedFeedback !== undefined && { minCombinedFeedback: incoming.minCombinedFeedback }),
          ...(incoming.recentExecutionsLimit !== undefined && { recentExecutionsLimit: incoming.recentExecutionsLimit }),
        };
      }
      if (Array.isArray(a.graphNodes) || Array.isArray(a.graphEdges)) {
        const existingGraph = def.graph;
        const graphNodes = (existingGraph != null && typeof existingGraph === "object" && !Array.isArray(existingGraph) && Array.isArray((existingGraph as { nodes?: unknown[] }).nodes))
          ? (existingGraph as { nodes: { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[] }).nodes
          : [];
        const graphEdges = (existingGraph != null && typeof existingGraph === "object" && !Array.isArray(existingGraph) && Array.isArray((existingGraph as { edges?: unknown[] }).edges))
          ? (existingGraph as { edges: { id: string; source: string; target: string }[] }).edges
          : [];
        if (Array.isArray(a.graphNodes)) {
          const nodes = a.graphNodes as { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[];
          const fallback = typeof a.systemPrompt === "string" && a.systemPrompt.trim() ? (a.systemPrompt as string).trim() : (def.systemPrompt as string | undefined);
          ensureLlmNodesHaveSystemPrompt(nodes, fallback);
          graphNodes.length = 0;
          graphNodes.push(...nodes);
        }
        if (Array.isArray(a.graphEdges)) {
          graphEdges.length = 0;
          graphEdges.push(...(a.graphEdges as { id: string; source: string; target: string }[]));
        }
        let updateToolIds = Array.isArray(a.toolIds) ? (a.toolIds as string[]).filter((x) => typeof x === "string") : (def.toolIds as string[] | undefined);
        if (!updateToolIds || updateToolIds.length === 0) {
          const fromGraph = graphNodes
            .filter((n) => n.type === "tool" && n.parameters && typeof (n.parameters as { toolId?: string }).toolId === "string")
            .map((n) => (n.parameters as { toolId: string }).toolId);
          if (fromGraph.length > 0) updateToolIds = [...new Set(fromGraph)];
        }
        if (updateToolIds && updateToolIds.length > 0) ensureToolNodesInGraph(graphNodes, graphEdges, updateToolIds);
        def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
      } else if (Array.isArray(a.toolIds) && a.toolIds.length > 0) {
        const existingGraph = def.graph;
        if (existingGraph != null && typeof existingGraph === "object" && !Array.isArray(existingGraph)) {
          const graphNodes = Array.isArray((existingGraph as { nodes?: unknown[] }).nodes)
            ? (existingGraph as { nodes: { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[] }).nodes
            : [];
          const graphEdges = Array.isArray((existingGraph as { edges?: unknown[] }).edges)
            ? (existingGraph as { edges: { id: string; source: string; target: string }[] }).edges
            : [];
          if (graphNodes.length > 0) {
            const toolIds = (a.toolIds as string[]).filter((x) => typeof x === "string");
            ensureToolNodesInGraph(graphNodes, graphEdges, toolIds);
            def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
          }
        }
      }
      (updated as { definition?: unknown }).definition = def;
      await db.update(agents).set(toAgentRow(updated)).where(eq(agents.id, id)).run();
      return { id, message: `Agent "${updated.name}" updated` };
    }
    case "delete_agent": {
      await db.delete(agents).where(eq(agents.id, a.id as string)).run();
      return { message: "Agent deleted" };
    }
    case "apply_agent_prompt_improvement": {
      const agentId = a.agentId as string;
      const autoApply = a.autoApply === true;
      const includeExecutionHistory = a.includeExecutionHistory !== false;
      const toolLearningArgs = {
        maxDerivedGood: typeof a.maxDerivedGood === "number" ? a.maxDerivedGood : undefined,
        maxDerivedBad: typeof a.maxDerivedBad === "number" ? a.maxDerivedBad : undefined,
        minCombinedFeedback: typeof a.minCombinedFeedback === "number" ? a.minCombinedFeedback : undefined,
        recentExecutionsLimit: typeof a.recentExecutionsLimit === "number" ? a.recentExecutionsLimit : undefined,
      };

      const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
      if (agentRows.length === 0) return { error: "Agent not found" };
      const agent = fromAgentRow(agentRows[0]);
      const definition = (agent as { definition?: Record<string, unknown> }).definition ?? {};
      const defObj = typeof definition === "object" && definition !== null && !Array.isArray(definition) ? (definition as Record<string, unknown>) : {};
      const learningConfig = resolveLearningConfig(defObj, toolLearningArgs);
      const currentSystemPrompt = (definition as { systemPrompt?: string }).systemPrompt ?? "";
      const currentSteps = (definition as { steps?: { name: string; type: string; content: string }[] }).steps;

      const explicitFbRows = await db
        .select()
        .from(feedback)
        .where(and(eq(feedback.targetType, "agent"), eq(feedback.targetId, agentId)));
      const explicitFeedback = explicitFbRows.map(fromFeedbackRow);

      let fromRuns: import("@agentron-studio/core").Feedback[] = [];
      if (includeExecutionHistory) {
        fromRuns = await deriveFeedbackFromExecutionHistory(agentId, {
          maxDerivedGood: learningConfig.maxDerivedGood,
          maxDerivedBad: learningConfig.maxDerivedBad,
          recentExecutionsLimit: learningConfig.recentExecutionsLimit,
        });
      }

      const combined = [...explicitFeedback, ...fromRuns];
      if (combined.length < learningConfig.minCombinedFeedback) {
        return {
          error: "No feedback or run history to refine from. Add labeled feedback for this agent or run workflows that use this agent.",
        };
      }

      let llmConfig: import("@agentron-studio/core").LLMConfig;
      if (agent.llmConfig && typeof agent.llmConfig === "object") {
        llmConfig = agent.llmConfig as import("@agentron-studio/core").LLMConfig;
      } else {
        const configRows = await db.select().from(llmConfigs);
        if (configRows.length === 0) return { error: "No LLM configured for this agent or globally" };
        llmConfig = fromLlmConfigRowWithSecret(configRows[0]) as import("@agentron-studio/core").LLMConfig;
      }

      const manager = createDefaultLLMManager(async (ref) => (ref ? process.env[ref] : undefined));
      const result = await refinePrompt(
        {
          currentSystemPrompt,
          currentSteps,
          feedback: combined,
        },
        (req) => manager.chat(llmConfig, req, { source: "agent", agentId })
      );

      if (autoApply && result.suggestedSystemPrompt) {
        const def = (agent as { definition?: Record<string, unknown> }).definition ?? {};
        const defObj = typeof def === "object" && def !== null && !Array.isArray(def) ? (def as Record<string, unknown>) : {};
        const graph = defObj.graph;
        const graphObj =
          graph != null && typeof graph === "object" && !Array.isArray(graph) ? (graph as Record<string, unknown>) : {};
        const graphNodes = Array.isArray(graphObj.nodes)
          ? (graphObj.nodes as { id: string; type?: string; position: [number, number]; parameters?: Record<string, unknown> }[])
          : [];
        const graphEdges = Array.isArray(graphObj.edges) ? (graphObj.edges as { id: string; source: string; target: string }[]) : [];
        const newDef: Record<string, unknown> = { ...defObj, systemPrompt: result.suggestedSystemPrompt };
        ensureLlmNodesHaveSystemPrompt(graphNodes, result.suggestedSystemPrompt);
        newDef.graph = { nodes: graphNodes.length > 0 ? graphNodes : (graphObj.nodes ?? []), edges: graphEdges };
        const updated = { ...agent, definition: newDef };
        await db.update(agents).set(toAgentRow(updated as import("@agentron-studio/core").Agent)).where(eq(agents.id, agentId)).run();
      }

      return {
        suggestedSystemPrompt: result.suggestedSystemPrompt,
        reasoning: result.reasoning,
        applied: autoApply,
        sources: { explicitFeedback: explicitFeedback.length, fromRuns: fromRuns.length },
      };
    }
    case "list_tools": {
      await ensureStandardTools();
      const rows = await db.select().from(tools);
      return rows.map(fromToolRow).map((t) => ({ id: t.id, name: t.name, protocol: t.protocol }));
    }
    case "get_tool": {
      await ensureStandardTools();
      const toolId = a.id as string;
      const toolRows = await db.select().from(tools).where(eq(tools.id, toolId));
      if (toolRows.length === 0) return { error: "Tool not found" };
      return fromToolRow(toolRows[0]);
    }
    case "update_tool": {
      const toolId = a.id as string;
      const toolRows = await db.select().from(tools).where(eq(tools.id, toolId));
      if (toolRows.length === 0) return { error: "Tool not found" };
      const existing = fromToolRow(toolRows[0]);
      const updated = { ...existing };
      if (toolId.startsWith("std-")) {
        if (a.inputSchema !== undefined) updated.inputSchema = a.inputSchema as Record<string, unknown>;
        if (a.outputSchema !== undefined) updated.outputSchema = a.outputSchema as Record<string, unknown>;
      } else {
        if (a.name !== undefined) updated.name = a.name as string;
        if (a.config !== undefined && typeof a.config === "object") updated.config = a.config as Record<string, unknown>;
        if (a.inputSchema !== undefined) updated.inputSchema = a.inputSchema as Record<string, unknown>;
      }
      await db.update(tools).set(toToolRow(updated)).where(eq(tools.id, toolId)).run();
      return { id: toolId, message: `Tool "${updated.name}" updated` };
    }
    case "create_tool": {
      const id = crypto.randomUUID();
      const config = (a.config && typeof a.config === "object" ? a.config as Record<string, unknown> : {}) as Record<string, unknown>;
      const tool = {
        id,
        name: (a.name && String(a.name).trim()) ? (a.name as string) : "Unnamed tool",
        protocol: ((a.protocol as string) || "native") as "native" | "http" | "mcp",
        config,
        inputSchema: a.inputSchema as Record<string, unknown> | undefined,
        outputSchema: a.outputSchema as Record<string, unknown> | undefined,
      };
      await db.insert(tools).values(toToolRow(tool)).run();
      return { id, name: tool.name, message: `Tool "${tool.name}" created. You can edit it at Tools in the sidebar.` };
    }
    case "list_workflows": {
      const rows = await db.select().from(workflows);
      return rows.map(fromWorkflowRow).map((w) => ({ id: w.id, name: w.name, executionMode: w.executionMode }));
    }
    case "get_workflow": {
      const wfId = a.id as string;
      const rows = await db.select().from(workflows).where(eq(workflows.id, wfId));
      if (rows.length === 0) return { error: "Workflow not found" };
      const w = fromWorkflowRow(rows[0]);
      const wNodes = Array.isArray(w.nodes) ? w.nodes : [];
      const wEdges = Array.isArray(w.edges) ? w.edges : [];
      return { id: w.id, name: w.name, executionMode: w.executionMode, nodes: wNodes, edges: wEdges, maxRounds: w.maxRounds, turnInstruction: (w as { turnInstruction?: string | null }).turnInstruction, branches: (w as { branches?: unknown }).branches };
    }
    case "add_workflow_edges": {
      const wfId = a.id as string;
      const newEdges = Array.isArray(a.edges) ? (a.edges as { id: string; source: string; target: string }[]) : [];
      const newNodes = Array.isArray(a.nodes) ? (a.nodes as { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> }[]) : [];
      const rows = await db.select().from(workflows).where(eq(workflows.id, wfId));
      if (rows.length === 0) return { error: "Workflow not found" };
      const existing = fromWorkflowRow(rows[0]);
      const existingNodes = Array.isArray(existing.nodes) ? (existing.nodes as { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> }[]) : [];
      type EdgeWithData = { id: string; source: string; target: string } & Record<string, unknown>;
      const existingEdges = Array.isArray(existing.edges) ? (existing.edges as EdgeWithData[]) : [];
      const nodeIds = new Set(existingNodes.map((n) => n.id));
      const mergedNodes = [...existingNodes];
      for (const n of newNodes) {
        if (n && n.id && !nodeIds.has(n.id)) {
          nodeIds.add(n.id);
          mergedNodes.push(n);
        }
      }
      const edgeIds = new Set(existingEdges.map((e) => e.id));
      const mergedEdges: EdgeWithData[] = [...existingEdges];
      for (const e of newEdges) {
        if (!e || typeof e !== "object") continue;
        const edgeObj = e as Record<string, unknown>;
        const src = String(edgeObj.source ?? edgeObj.from ?? edgeObj.sourceId ?? "");
        const tgt = String(edgeObj.target ?? edgeObj.to ?? edgeObj.targetId ?? "");
        if (!src || !tgt) continue;
        const id = String(edgeObj.id ?? `e-${src}-${tgt}`);
        if (!edgeIds.has(id)) {
          edgeIds.add(id);
          mergedEdges.push({ ...edgeObj, id, source: src, target: tgt } as EdgeWithData);
        }
      }
      const merged = { ...existing, nodes: mergedNodes, edges: mergedEdges };
      if (a.maxRounds != null) (merged as { maxRounds?: number }).maxRounds = Number(a.maxRounds);
      if (a.turnInstruction !== undefined) (merged as { turnInstruction?: string | null }).turnInstruction = a.turnInstruction === null ? null : String(a.turnInstruction);
      await db.update(workflows).set(toWorkflowRow(merged)).where(eq(workflows.id, wfId)).run();
      return { id: wfId, message: `Added ${newEdges.length} edge(s) to workflow`, nodes: mergedNodes.length, edges: mergedEdges.length };
    }
    case "create_workflow": {
      const id = crypto.randomUUID();
      const wfName = (a.name && String(a.name).trim()) ? (a.name as string) : randomWorkflowName();
      const wf = {
        id,
        name: wfName,
        executionMode: (a.executionMode || "one_time") as "one_time",
        nodes: [],
        edges: [],
      };
      await db.insert(workflows).values(toWorkflowRow(wf)).run();
      return { id, name: wf.name, message: `Workflow "${wf.name}" created` };
    }
    case "update_workflow": {
      const wfId = a.id as string;
      const rows = await db.select().from(workflows).where(eq(workflows.id, wfId));
      if (rows.length === 0) return { error: "Workflow not found" };
      const row = rows[0];
      const existing = row != null ? fromWorkflowRow(row) : null;
      const base = existing != null && typeof existing === "object" ? existing : { id: wfId, name: "", description: undefined, nodes: [] as unknown[], edges: [] as unknown[], executionMode: "one_time" as const, schedule: undefined, maxRounds: undefined };
      const updated: Record<string, unknown> = { ...base };
      if (a.name != null) updated.name = String(a.name);
      if (a.executionMode != null) updated.executionMode = a.executionMode as "one_time" | "continuous" | "interval";
      if (a.schedule !== undefined) updated.schedule = a.schedule === null ? undefined : String(a.schedule);
      if (a.maxRounds != null) updated.maxRounds = Number(a.maxRounds);
      if (a.turnInstruction !== undefined) updated.turnInstruction = a.turnInstruction === null ? null : String(a.turnInstruction);
      if (a.branches !== undefined) updated.branches = Array.isArray(a.branches) ? a.branches : undefined;
      let updateWorkflowWarning: string | undefined;
      if (Array.isArray(a.nodes)) {
        const normalizedNodes: { id: string; type: string; position: [number, number]; parameters: Record<string, unknown> }[] = [];
        let nonAgentCount = 0;
        for (let i = 0; i < a.nodes.length; i++) {
          const n = a.nodes[i];
          if (n == null || typeof n !== "object") continue;
          const id = String((n as { id?: unknown }).id ?? "");
          const type = String((n as { type?: unknown }).type ?? "agent");
          if (type !== "agent") {
            nonAgentCount++;
            continue;
          }
          const pos = (n as { position?: unknown }).position;
          const position: [number, number] = Array.isArray(pos) && pos.length >= 2 && typeof pos[0] === "number" && typeof pos[1] === "number" ? [pos[0], pos[1]] : [0, 0];
          const params = (n as { parameters?: unknown }).parameters;
          let parameters: Record<string, unknown> = {};
          if (params != null && typeof params === "object" && !Array.isArray(params)) {
            try {
              parameters = { ...(params as Record<string, unknown>) };
            } catch {
              parameters = {};
            }
          }
          if (!parameters.agentId && parameters.agentName != null) {
            const byName = await db.select().from(agents).where(eq(agents.name, String(parameters.agentName)));
            if (byName.length > 0) parameters.agentId = byName[0].id;
          }
          normalizedNodes.push({ id: id || `n-${i}`, type, position, parameters });
        }
        if (nonAgentCount > 0) {
          updateWorkflowWarning = `Ignored ${nonAgentCount} node(s) with type other than 'agent'; workflow nodes must be type 'agent'.`;
        }
        const agentNodesWithoutId = normalizedNodes.filter((nd) => !(typeof nd.parameters?.agentId === "string" && nd.parameters.agentId.trim() !== ""));
        if (agentNodesWithoutId.length > 0) {
          return { error: "Workflow has agent node(s) without an agent selected. Set parameters.agentId (or parameters.agentName) for each agent node so the workflow can run." };
        }
        updated.nodes = normalizedNodes;
      }
      if (Array.isArray(a.edges)) {
        const normalizedEdges: Array<{ id: string; source: string; target: string } & Record<string, unknown>> = [];
        for (let i = 0; i < a.edges.length; i++) {
          const e = a.edges[i];
          if (e == null || typeof e !== "object") continue;
          const edgeObj = e as Record<string, unknown>;
          const src = String(edgeObj.source ?? edgeObj.from ?? edgeObj.sourceId ?? "");
          const tgt = String(edgeObj.target ?? edgeObj.to ?? edgeObj.targetId ?? "");
          if (!src || !tgt) continue;
          const id = String(edgeObj.id ?? `e-${i}-${src}-${tgt}`);
          normalizedEdges.push({ ...edgeObj, id, source: src, target: tgt });
        }
        updated.edges = normalizedEdges;
      }
      const workflowPayload = { id: updated.id, name: updated.name, description: updated.description, nodes: updated.nodes ?? [], edges: updated.edges ?? [], executionMode: updated.executionMode, schedule: updated.schedule, maxRounds: updated.maxRounds, turnInstruction: updated.turnInstruction, branches: updated.branches };
      await db.update(workflows).set(toWorkflowRow(workflowPayload as Parameters<typeof toWorkflowRow>[0])).where(eq(workflows.id, wfId)).run();
      const nodeList = Array.isArray(workflowPayload.nodes) ? workflowPayload.nodes : [];
      const edgeList = Array.isArray(workflowPayload.edges) ? workflowPayload.edges : [];
      const result: { id: string; message: string; nodes: number; edges: number; warning?: string } = { id: wfId, message: `Workflow "${updated.name}" updated`, nodes: nodeList.length, edges: edgeList.length };
      if (updateWorkflowWarning) result.warning = updateWorkflowWarning;
      return result;
    }
    case "delete_workflow": {
      const wfId = a.id as string;
      const wfRows = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(eq(workflows.id, wfId));
      if (wfRows.length === 0) return { error: "Workflow not found" };
      await db.delete(workflows).where(eq(workflows.id, wfId)).run();
      return { id: wfId, message: `Workflow "${wfRows[0].name}" deleted` };
    }
    case "create_custom_function": {
      const id = crypto.randomUUID();
      const fn = {
        id,
        name: a.name as string,
        language: a.language as string,
        source: a.source as string,
        description: (a.description as string) || undefined,
        createdAt: Date.now(),
      };
      await db.insert(customFunctions).values(toCustomFunctionRow(fn)).run();
      return { id, name: fn.name, message: `Function "${fn.name}" created` };
    }
    case "create_sandbox": {
      const id = crypto.randomUUID();
      const name = (a.name as string) || `sandbox-${id.slice(0, 8)}`;
      const image = a.image as string;
      let containerId: string | undefined;
      let status = "creating";
      const podman = getContainerManager();
      try {
        containerId = await podman.create(image, name, {});
        status = "running";
      } catch (err) {
        status = "stopped";
        const msg = err instanceof Error ? err.message : String(err);
        if (withContainerInstallHint(msg) !== msg) {
          return { id, name, status: "stopped", message: withContainerInstallHint(msg) };
        }
      }
      await db.insert(sandboxes).values(toSandboxRow({
        id, name, image, status: status as "running", containerId, config: {}, createdAt: Date.now()
      })).run();
      return { id, name, status, message: status === "running" ? `Sandbox "${name}" running` : "Sandbox created but failed to start" };
    }
    case "execute_code": {
      const sbId = a.sandboxId as string;
      const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sbId));
      if (rows.length === 0) return { error: "Sandbox not found" };
      const sb = fromSandboxRow(rows[0]);
      if (!sb.containerId) return { error: "Sandbox has no container" };
      return getContainerManager().exec(sb.containerId, a.command as string);
    }
    case "run_container_command": {
      const image = (a.image as string)?.trim();
      const rawCmd = a.command;
      const command = typeof rawCmd === "string" ? rawCmd.trim() : Array.isArray(rawCmd) ? rawCmd.map(String).join(" ") : "";
      if (!image || !command) return { error: "image and command are required" };
      const name = `chat-one-shot-${Date.now()}`;
      const mgr = getContainerManager();
      const isImageNotFound = (m: string) => {
        const s = m.toLowerCase();
        return s.includes("no such image") || s.includes("manifest unknown") || s.includes("not found") || s.includes("pull access denied") || s.includes("unable to find image");
      };
      let containerId: string;
      try {
        containerId = await mgr.create(image, name, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isImageNotFound(msg)) {
          try {
            await mgr.pull(image);
            containerId = await mgr.create(image, name, {});
          } catch (pullErr) {
            const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
            const enhanced = withContainerInstallHint(pullMsg);
            return { error: enhanced !== pullMsg ? enhanced : `Failed to pull/create: ${pullMsg}`, stdout: "", stderr: pullMsg, exitCode: -1 };
          }
        } else {
          const enhanced = withContainerInstallHint(msg);
          return { error: enhanced !== msg ? enhanced : `Failed to create container: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
        }
      }
      try {
        const result = await mgr.exec(containerId, command);
        return result;
      } finally {
        try { await mgr.destroy(containerId); } catch { /* ignore */ }
      }
    }
    case "list_sandboxes": {
      const rows = await db.select().from(sandboxes);
      return rows.map(fromSandboxRow).map((s) => ({ id: s.id, name: s.name, image: s.image, status: s.status }));
    }
    case "list_files": {
      const rows = await db.select().from(files);
      return rows.map(fromFileRow).map((f) => ({ id: f.id, name: f.name, size: f.size }));
    }
    case "list_runs": {
      const rows = await db.select().from(executions);
      return rows.slice(-20).map((r) => ({ id: r.id, targetType: r.targetType, targetId: r.targetId, status: r.status }));
    }
    case "cancel_run": {
      const runId = typeof a.runId === "string" ? (a.runId as string).trim() : "";
      if (!runId) return { error: "runId is required" };
      const runRows = await db.select().from(executions).where(eq(executions.id, runId));
      if (runRows.length === 0) return { error: "Run not found" };
      const run = runRows[0];
      if (run.status !== "waiting_for_user" && run.status !== "running") {
        return { error: `Run cannot be cancelled (status: ${run.status})`, runId };
      }
      await db.update(executions).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(executions.id, runId)).run();
      return { id: runId, status: "cancelled", message: "Run cancelled." };
    }
    case "respond_to_run": {
      const runId = typeof a.runId === "string" ? (a.runId as string).trim() : "";
      const response = typeof a.response === "string" ? (a.response as string).trim() : "(no text)";
      if (!runId) return { error: "runId is required" };
      const runRows = await db.select().from(executions).where(eq(executions.id, runId));
      if (runRows.length === 0) return { error: "Run not found" };
      const run = runRows[0];
      if (run.status !== "waiting_for_user") {
        return { error: `Run is not waiting for user input (status: ${run.status})`, runId };
      }
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
      enqueueWorkflowRun(() => runWorkflowForRun(runId, { resumeUserResponse: response }));
      return { id: runId, status: "running", message: "Response sent to run. The workflow continues. [View run](/runs/" + runId + ") to see progress." };
    }
    case "get_run": {
      const runId = a.id as string;
      const runRows = await db.select().from(executions).where(eq(executions.id, runId));
      if (runRows.length === 0) return { error: "Run not found" };
      const run = runRows[0] as { id: string; targetType: string; targetId: string; status: string; startedAt: number; finishedAt: number | null; output: string | null };
      const output = run.output ? (() => { try { return JSON.parse(run.output) as unknown; } catch { return run.output; } })() : undefined;
      return { id: run.id, targetType: run.targetType, targetId: run.targetId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, output };
    }
    case "execute_workflow": {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/af7dcd5d-c72d-47cc-bc97-a16719175ca2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat/route.ts:execute_workflow',message:'execute_workflow args',data:{hasId:!!(a as Record<string,unknown>).id,hasWorkflowId:!!(a as Record<string,unknown>).workflowId,idVal:(a as Record<string,unknown>).id,workflowIdVal:(a as Record<string,unknown>).workflowId},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const workflowId = ((a as Record<string, unknown>).workflowId ?? (a as Record<string, unknown>).id) as string;
      if (!workflowId || typeof workflowId !== "string" || !workflowId.trim()) return { error: "Workflow id is required" };
      const branchId = typeof a.branchId === "string" && a.branchId.trim() ? (a.branchId as string) : undefined;
      const wfRows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (wfRows.length === 0) return { error: "Workflow not found" };
      const runId = crypto.randomUUID();
      const run = { id: runId, targetType: "workflow", targetId: workflowId, targetBranchId: branchId ?? null, conversationId: conversationId ?? null, status: "running" };
      await db.insert(executions).values(toExecutionRow(run)).run();
      try {
        const onStepComplete = async (trail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>, lastOutput: unknown) => {
          const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
          await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
        };
        const onProgress = async (
          state: { message: string; toolId?: string },
          currentTrail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>
        ) => {
          const payload = executionOutputSuccess(undefined, currentTrail.length > 0 ? currentTrail : undefined, state.message);
          await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
        };
        const isCancelled = async () => {
          const rows = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, runId));
          return rows[0]?.status === "cancelled";
        };
        const { output, context, trail } = await runWorkflow({ workflowId, runId, branchId, onStepComplete, onProgress, isCancelled });
        const payload = executionOutputSuccess(output ?? context, trail);
        await db.update(executions).set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
        const updated = await db.select().from(executions).where(eq(executions.id, runId));
        const runResult = fromExecutionRow(updated[0]);
        return { id: runId, workflowId, status: "completed", message: "Workflow run completed. Check Runs in the sidebar for full output and execution trail.", output: runResult.output };
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const cancelled = rawMessage === RUN_CANCELLED_MESSAGE;
        if (cancelled) {
          await db.update(executions).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(executions.id, runId)).run();
          return { id: runId, workflowId, status: "cancelled", message: "Run was stopped by the user." };
        }
        if (rawMessage === WAITING_FOR_USER_MESSAGE) {
          // Forward the run's question/options so the chat UI can show them without a separate run-waiting request
          let question: string | undefined;
          let options: string[] = [];
          try {
            const runRows = await db.select({ output: executions.output }).from(executions).where(eq(executions.id, runId));
            const raw = runRows[0]?.output;
            const out = raw == null ? undefined : (typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>));
            if (out && typeof out === "object") {
              const inner = out.output && typeof out.output === "object" && out.output !== null ? (out.output as Record<string, unknown>) : out;
              const q = (typeof inner?.question === "string" ? inner.question : undefined)?.trim();
              const msg = (typeof inner?.message === "string" ? inner.message : undefined)?.trim();
              question = (q || msg) || undefined;
              const opts = Array.isArray(inner?.suggestions) ? inner.suggestions : Array.isArray(inner?.options) ? inner.options : undefined;
              options = opts?.map((o) => String(o)).filter(Boolean) ?? [];
            }
          } catch {
            // ignore
          }
          return {
            id: runId,
            workflowId,
            status: "waiting_for_user",
            message: "Run is waiting for user input. Respond from Chat or the run detail page.",
            ...(question && { question }),
            ...(options.length > 0 && { options }),
          };
        }
        const message = withContainerInstallHint(rawMessage);
        const payload = executionOutputFailure(message, { message, stack: err instanceof Error ? err.stack : undefined });
        await db.update(executions).set({ status: "failed", finishedAt: Date.now(), output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
        return { id: runId, workflowId, status: "failed", error: message, message: `Workflow run failed: ${message}` };
      }
    }
    case "web_search": {
      const query = typeof a.query === "string" ? (a.query as string).trim() : "";
      if (!query) return { error: "query is required", results: [] };
      const maxResults = typeof a.maxResults === "number" && a.maxResults > 0 ? Math.min(a.maxResults, 20) : undefined;
      try {
        const out = await searchWeb(query, { maxResults });
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Web search failed", message, results: [] };
      }
    }
    case "fetch_url": {
      const url = typeof a.url === "string" ? (a.url as string).trim() : "";
      if (!url) return { error: "url is required" };
      try {
        return await fetchUrl({ url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Fetch failed", message };
      }
    }
    case "answer_question": {
      // Pass through — the LLM already has the question in context.
      // Return a signal so the follow-up LLM call can produce the real answer.
      return { message: "Answering general question", question: a.question as string };
    }
    case "explain_software": {
      const topic = (a.topic as string || "general").toLowerCase();
      const docs: Record<string, string> = {
        general: "AgentOS Studio is a local-first platform for building, managing, and running AI agents. It supports agents (with customizable prompts and steps), workflows (chaining agents together), tools (native, MCP, HTTP), custom code functions, Podman-based sandboxes for code execution, file context for agents, feedback-driven learning, and an AI chat assistant.",
        agents: "Agents are the core building blocks. Each agent has a kind (node or code), a protocol (native, MCP, HTTP), a system prompt, optional steps, and can be connected to tools and LLMs. Agents can learn from user feedback — thumbs up/down on their outputs refines their prompts over time.",
        workflows: "Workflows chain multiple agents together into a pipeline. They support execution modes: one_time, continuous, or interval. Agents within a workflow share context so outputs from one agent can be used by the next.",
        tools: "Tools extend what agents can do. They can be native (built-in), MCP (Model Context Protocol), or HTTP (external APIs). Custom code functions also register as native tools automatically.",
        sandboxes: "Sandboxes are Podman or Docker containers that provide isolated execution environments. The user chooses the engine in Settings → Container Engine. They support any language or runtime — just specify a container image. You can execute commands, mount files, and even run databases inside them. If the user needs to install Podman or Docker, direct them to the installation guide: [Installing Podman](/podman-install).",
        functions: "Custom functions let you write code (JavaScript, Python, TypeScript) that becomes a tool agents can call. Functions run inside sandboxes for isolation.",
        files: "You can upload context files that agents can access during execution. Files are stored locally and can be mounted into sandboxes. The assistant can also create files with std-write-file (name and content); use the returned contextDir with std-container-build to build images from a Containerfile, or pass dockerfileContent to std-container-build for a one-step build.",
        feedback: "The feedback system lets you rate agent outputs as good or bad. This feedback is used in two ways: runtime injection (few-shot examples added to prompts) and on-demand LLM-driven prompt refinement.",
      };
      const explanation = docs[topic] || docs.general;
      return { message: explanation, topic };
    }
    case "run_shell_command": {
      const command = typeof a.command === "string" ? (a.command as string).trim() : "";
      if (!command) return { error: "command is required", needsApproval: false };
      const allowlist = getShellCommandAllowlist();
      const isAllowed = allowlist.some((entry) => entry === command);
      if (!isAllowed) {
        return { needsApproval: true, command, message: "Command requires user approval. The user can approve it in the chat UI or add it to the allowlist in Settings." };
      }
      try {
        const { stdout, stderr, exitCode } = await runShellCommand(command);
        return { command, stdout, stderr, exitCode, message: stderr ? `stdout:\n${stdout}\nstderr:\n${stderr}` : stdout || "(no output)" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Shell command failed", message, exitCode: -1 };
      }
    }
    case "list_remote_servers": {
      const rows = await db.select().from(remoteServers);
      return { servers: rows.map(fromRemoteServerRow).map((s) => ({ id: s.id, label: s.label, host: s.host, port: s.port, user: s.user, authType: s.authType, modelBaseUrl: s.modelBaseUrl })) };
    }
    case "test_remote_connection": {
      const host = a.host as string;
      const user = a.user as string;
      if (!host || !user) return { error: "host and user are required" };
      return testRemoteConnection({
        host,
        port: a.port as number | undefined,
        user,
        authType: (a.authType as string) || "key",
        keyPath: a.keyPath as string | undefined,
      });
    }
    case "save_remote_server": {
      const id = crypto.randomUUID();
      const server: RemoteServer = {
        id,
        label: (a.label as string) || "Remote server",
        host: a.host as string,
        port: Number(a.port) || 22,
        user: a.user as string,
        authType: a.authType === "password" ? "password" : "key",
        keyPath: (a.keyPath as string) || undefined,
        modelBaseUrl: (a.modelBaseUrl as string) || undefined,
        createdAt: Date.now(),
      };
      await db.insert(remoteServers).values(toRemoteServerRow(server)).run();
      return { id, message: `Saved remote server "${server.label}". You can use it when creating new agents. Passwords are not stored; for password auth the user will be prompted when using this server.`, server: { id: server.id, label: server.label, host: server.host, port: server.port, user: server.user } };
    }
    case "remember": {
      const value = (a.value as string)?.trim();
      if (!value) return { error: "value is required" };
      const key = typeof a.key === "string" ? a.key.trim() || null : null;
      const id = crypto.randomUUID();
      await db.insert(assistantMemory).values(toAssistantMemoryRow({ id, key, content: value, createdAt: Date.now() })).run();
      return { id, message: key ? `Remembered "${key}": ${value.slice(0, 80)}${value.length > 80 ? "…" : ""}` : `Remembered: ${value.slice(0, 80)}${value.length > 80 ? "…" : ""}` };
    }
    case "get_assistant_setting": {
      const key = a.key as string;
      if (key !== "recentSummariesCount") return { error: "Unsupported setting key" };
      const rows = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, "default"));
      const settings = rows.length > 0 ? fromChatAssistantSettingsRow(rows[0]) : null;
      const count = settings?.recentSummariesCount ?? DEFAULT_RECENT_SUMMARIES_COUNT;
      return { key, value: count };
    }
    case "set_assistant_setting": {
      const key = a.key as string;
      if (key !== "recentSummariesCount") return { error: "Unsupported setting key" };
      let value = Number(a.value);
      if (Number.isNaN(value) || value < MIN_SUMMARIES || value > MAX_SUMMARIES) {
        value = Math.max(MIN_SUMMARIES, Math.min(MAX_SUMMARIES, Math.round(value)));
      } else {
        value = Math.round(value);
      }
      const rows = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, "default"));
      const now = Date.now();
      if (rows.length === 0) {
        await db.insert(chatAssistantSettings).values(toChatAssistantSettingsRow({
          id: "default",
          customSystemPrompt: null,
          contextAgentIds: null,
          contextWorkflowIds: null,
          contextToolIds: null,
          recentSummariesCount: value,
          temperature: null,
          historyCompressAfter: null,
          historyKeepRecent: null,
          updatedAt: now,
        })).run();
      } else {
        await db.update(chatAssistantSettings).set({ recentSummariesCount: value, updatedAt: now }).where(eq(chatAssistantSettings.id, "default")).run();
      }
      return { key, value, message: `Set ${key} to ${value}. Up to ${value} recent conversation summaries will be included in context.` };
    }
    case "create_improvement_job": {
      const id = crypto.randomUUID();
      await db.insert(improvementJobs).values({
        id,
        name: typeof a.name === "string" ? a.name : null,
        scopeType: typeof a.scopeType === "string" ? a.scopeType : null,
        scopeId: typeof a.scopeId === "string" ? a.scopeId : null,
        studentLlmConfigId: typeof a.studentLlmConfigId === "string" ? a.studentLlmConfigId : null,
        teacherLlmConfigId: typeof a.teacherLlmConfigId === "string" ? a.teacherLlmConfigId : null,
        currentModelRef: null,
        instanceRefs: null,
        architectureSpec: null,
        lastTrainedAt: null,
        lastFeedbackAt: null,
        createdAt: Date.now(),
      }).run();
      return { id, message: "Improvement job created." };
    }
    case "get_improvement_job": {
      const jobId = a.id as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const r = rows[0];
      const instanceRefs = r.instanceRefs ? (() => { try { return JSON.parse(r.instanceRefs) as string[]; } catch { return []; } })() : [];
      const architectureSpec = r.architectureSpec ? (() => { try { return JSON.parse(r.architectureSpec) as Record<string, unknown>; } catch { return undefined; } })() : undefined;
      return { id: r.id, name: r.name, scopeType: r.scopeType, scopeId: r.scopeId, studentLlmConfigId: r.studentLlmConfigId, teacherLlmConfigId: r.teacherLlmConfigId, currentModelRef: r.currentModelRef, instanceRefs, architectureSpec, lastTrainedAt: r.lastTrainedAt, lastFeedbackAt: r.lastFeedbackAt, createdAt: r.createdAt };
    }
    case "list_improvement_jobs": {
      const rows = await db.select().from(improvementJobs).orderBy(desc(improvementJobs.createdAt));
      return rows.map((r) => ({ id: r.id, name: r.name, scopeType: r.scopeType, scopeId: r.scopeId, currentModelRef: r.currentModelRef, lastTrainedAt: r.lastTrainedAt }));
    }
    case "update_improvement_job": {
      const jobId = a.id as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const updates: Record<string, unknown> = {};
      if (a.currentModelRef !== undefined) updates.currentModelRef = a.currentModelRef;
      if (Array.isArray(a.instanceRefs)) updates.instanceRefs = JSON.stringify(a.instanceRefs);
      if (a.architectureSpec != null && typeof a.architectureSpec === "object") updates.architectureSpec = JSON.stringify(a.architectureSpec);
      if (typeof a.lastTrainedAt === "number") updates.lastTrainedAt = a.lastTrainedAt;
      if (Object.keys(updates).length === 0) return { id: jobId, message: "No updates" };
      await db.update(improvementJobs).set(updates as Record<string, unknown>).where(eq(improvementJobs.id, jobId)).run();
      return { id: jobId, message: "Job updated." };
    }
    case "generate_training_data": {
      const strategy = (a.strategy as string) || "from_feedback";
      const scopeType = (a.scopeType as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const jobId = (a.jobId as string) || "";
      const since = typeof a.since === "number" ? a.since : undefined;
      if (strategy === "from_feedback") {
        const feedbackRows = await db.select().from(feedback).where(
          scopeId ? eq(feedback.targetId, scopeId) : isNotNull(feedback.id)
        ).orderBy(desc(feedback.createdAt));
        const filtered = since ? feedbackRows.filter((f) => f.createdAt >= since) : feedbackRows;
        const slice = filtered.slice(0, 500);
        const datasetRef = `.data/improvement/from_feedback_${Date.now()}.jsonl`;
        return { datasetRef, strategy, count: slice.length, message: `Generated ${slice.length} feedback rows for training. Save to ${datasetRef} for trigger_training.` };
      }
      return { datasetRef: `.data/improvement/${strategy}_${Date.now()}.jsonl`, strategy, message: "Dataset ref created; use trigger_training with this ref. Teacher/self_play require external data generation." };
    }
    case "evaluate_model": {
      const jobId = a.jobId as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      return { jobId, metrics: { accuracy: 0, loss: null }, message: "Evaluation stub; plug in eval set and run student for real metrics." };
    }
    case "trigger_training": {
      const jobId = a.jobId as string;
      const datasetRef = (a.datasetRef as string) || "";
      const backend = (a.backend as string) || "local";
      const addInstance = !!a.addInstance;
      const runId = crypto.randomUUID();
      const localUrl = process.env.LOCAL_TRAINER_URL || "http://localhost:8765";
      if (backend === "local") {
        try {
          const res = await fetch(`${localUrl}/train`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, datasetRef, runId }),
          });
          const data = await res.json().catch(() => ({}));
          const extId = (data.run_id ?? data.id ?? runId) as string;
          await db.insert(trainingRuns).values({ id: runId, jobId, backend: "local", status: "pending", datasetRef, outputModelRef: null, config: JSON.stringify({ addInstance }), createdAt: Date.now(), finishedAt: null }).run();
          return { runId, backend, status: "pending", message: `Training started. Poll get_training_status(runId: ${runId}) for completion.` };
        } catch {
          await db.insert(trainingRuns).values({ id: runId, jobId, backend: "local", status: "pending", datasetRef, outputModelRef: null, config: JSON.stringify({ addInstance }), createdAt: Date.now(), finishedAt: null }).run();
          return { runId, backend, status: "pending", message: `Training run created (local trainer at ${localUrl} may be unavailable). Poll get_training_status(runId: ${runId}).` };
        }
      }
      await db.insert(trainingRuns).values({ id: runId, jobId, backend, status: "pending", datasetRef, outputModelRef: null, config: JSON.stringify({ addInstance }), createdAt: Date.now(), finishedAt: null }).run();
      return { runId, backend, status: "pending", message: `Training run created. Poll get_training_status(runId: ${runId}) for replicate/huggingface.` };
    }
    case "get_training_status": {
      const runId = (a.runId as string) || "";
      const rows = await db.select().from(trainingRuns).where(eq(trainingRuns.id, runId));
      if (rows.length === 0) return { error: "Run not found" };
      const r = rows[0];
      return { runId: r.id, status: r.status, outputModelRef: r.outputModelRef, finishedAt: r.finishedAt };
    }
    case "decide_optimization_target": {
      const scopeType = (a.scopeType as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      return { target: "model_instance", scope: scopeType, reason: "Use model_instance to generate data and trigger training; use prompt when only instructions need change.", optionalSpec: null };
    }
    case "get_technique_knowledge": {
      const jobId = (a.jobId as string) || "";
      const playbookRows = await db.select().from(techniquePlaybook);
      let playbook = playbookRows.map((p) => ({ name: p.name, description: p.description, whenToUse: p.whenToUse, downsides: p.downsides }));
      if (playbook.length === 0) {
        playbook = [
          { name: "Teacher distillation", description: "Use a stronger LLM to produce trajectories; train small model to imitate. Cold start before any RL.", whenToUse: "When the student has no prior agentic data.", downsides: "Requires teacher inference cost." },
          { name: "LoRA/DoRA", description: "Low-rank adapters; only a small set of parameters updated.", whenToUse: "Prefer for add-instance and memory-constrained training.", downsides: "May underfit if rank too low." },
          { name: "from_feedback", description: "Training data from user ratings (good/bad) and run outcomes.", whenToUse: "When you have feedback in the feedback table for the scope.", downsides: "Needs enough feedback; sparse signal." },
          { name: "Contrastive", description: "Train on both positive and negative traces.", whenToUse: "When you have both good and bad runs.", downsides: "Can cause instability if feedback count is low." },
          { name: "Multi-instance", description: "Spawn multiple instances; do not overwrite single model.", whenToUse: "To avoid capability collapse; specialization per tool/task.", downsides: "More compute and routing logic." },
        ];
      }
      const insights = jobId ? await db.select().from(techniqueInsights).where(eq(techniqueInsights.jobId, jobId)).orderBy(desc(techniqueInsights.createdAt)) : [];
      return { playbook, recentInsights: insights.slice(0, 10).map((i) => ({ techniqueOrStrategy: i.techniqueOrStrategy, outcome: i.outcome, summary: i.summary })) };
    }
    case "record_technique_insight": {
      const id = crypto.randomUUID();
      await db.insert(techniqueInsights).values({
        id,
        jobId: (a.jobId as string) || "",
        runId: typeof a.runId === "string" ? a.runId : null,
        techniqueOrStrategy: (a.techniqueOrStrategy as string) || "",
        outcome: (a.outcome as string) || "neutral",
        summary: (a.summary as string) || "",
        config: a.config != null ? JSON.stringify(a.config) : null,
        createdAt: Date.now(),
      }).run();
      return { id, message: "Insight recorded." };
    }
    case "propose_architecture": {
      const jobId = a.jobId as string;
      const spec = a.spec as Record<string, unknown>;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      await db.update(improvementJobs).set({ architectureSpec: JSON.stringify(spec || {}) }).where(eq(improvementJobs.id, jobId)).run();
      return { jobId, message: "Architecture spec attached to job. Next trigger_training will pass it to the backend if supported." };
    }
    case "spawn_instance": {
      return executeTool("trigger_training", { ...a, addInstance: true });
    }
    case "create_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const name = (a.name as string) || "";
      if (!scopeId || !name) return { error: "scopeId and name required" };
      return { message: "Store is created when you first put_store a key. No separate create needed." };
    }
    case "put_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const key = (a.key as string) || "";
      const value = typeof a.value === "string" ? a.value : JSON.stringify(a.value ?? "");
      const id = crypto.randomUUID();
      const existing = await db.select().from(agentStoreEntries).where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId), eq(agentStoreEntries.storeName, storeName), eq(agentStoreEntries.key, key)));
      if (existing.length > 0) {
        await db.update(agentStoreEntries).set({ value, createdAt: Date.now() }).where(eq(agentStoreEntries.id, existing[0].id)).run();
        return { message: "Updated." };
      }
      await db.insert(agentStoreEntries).values({ id, scope, scopeId, storeName, key, value, createdAt: Date.now() }).run();
      return { message: "Stored." };
    }
    case "get_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const key = (a.key as string) || "";
      const rows = await db.select().from(agentStoreEntries).where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId), eq(agentStoreEntries.storeName, storeName), eq(agentStoreEntries.key, key)));
      if (rows.length === 0) return { error: "Key not found" };
      return { value: rows[0].value };
    }
    case "query_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const prefix = (a.prefix as string) || "";
      const rows = await db.select().from(agentStoreEntries).where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId), eq(agentStoreEntries.storeName, storeName)));
      const filtered = prefix ? rows.filter((r) => r.key.startsWith(prefix)) : rows;
      return { entries: filtered.map((r) => ({ key: r.key, value: r.value })) };
    }
    case "list_stores": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const rows = await db.select({ storeName: agentStoreEntries.storeName }).from(agentStoreEntries).where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId)));
      const names = [...new Set(rows.map((r) => r.storeName))];
      return { stores: names };
    }
    case "delete_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      await db.delete(agentStoreEntries).where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId), eq(agentStoreEntries.storeName, storeName))).run();
      return { message: "Store deleted." };
    }
    case "create_guardrail": {
      const id = crypto.randomUUID();
      const scope = (a.scope as string) || "deployment";
      const scopeId = (a.scopeId as string) || null;
      const config = a.config != null && typeof a.config === "object" ? (a.config as Record<string, unknown>) : {};
      await db.insert(guardrails).values({ id, scope, scopeId, config: JSON.stringify(config), createdAt: Date.now() }).run();
      return { id, message: "Guardrail created. It will be applied when the agent uses fetch/browser." };
    }
    case "list_guardrails": {
      const scope = a.scope as string | undefined;
      const scopeId = a.scopeId as string | undefined;
      let rows = await db.select().from(guardrails);
      if (scope) rows = rows.filter((r) => r.scope === scope);
      if (scopeId) rows = rows.filter((r) => r.scopeId === scopeId);
      return { guardrails: rows.map((r) => ({ id: r.id, scope: r.scope, scopeId: r.scopeId, config: r.config })) };
    }
    case "get_guardrail": {
      const gid = a.id as string;
      const rows = await db.select().from(guardrails).where(eq(guardrails.id, gid));
      if (rows.length === 0) return { error: "Guardrail not found" };
      const r = rows[0];
      return { id: r.id, scope: r.scope, scopeId: r.scopeId, config: typeof r.config === "string" ? JSON.parse(r.config) : r.config };
    }
    case "update_guardrail": {
      const gid = a.id as string;
      const config = a.config != null && typeof a.config === "object" ? JSON.stringify(a.config) : undefined;
      if (!config) return { error: "config required" };
      await db.update(guardrails).set({ config }).where(eq(guardrails.id, gid)).run();
      return { id: gid, message: "Guardrail updated." };
    }
    case "delete_guardrail": {
      const gid = a.id as string;
      await db.delete(guardrails).where(eq(guardrails.id, gid)).run();
      return { message: "Guardrail deleted." };
    }
    case "send_to_openclaw": {
      const content = (a.content as string)?.trim();
      if (!content) return { error: "content is required" };
      try {
        const result = await openclawSend(content);
        return { ...result, message: result.runId ? "Message sent to OpenClaw." : result.message ?? "Sent." };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}`, message: "Make sure the OpenClaw Gateway is running (e.g. openclaw gateway) and OPENCLAW_GATEWAY_URL/OPENCLAW_GATEWAY_TOKEN are set if needed." };
      }
    }
    case "openclaw_history": {
      try {
        const limit = typeof a.limit === "number" && a.limit > 0 ? Math.min(a.limit, 50) : 20;
        const result = await openclawHistory({ limit });
        if (result.error) return { error: result.error, messages: [] };
        return { messages: result.messages ?? [], message: `Last ${(result.messages ?? []).length} message(s) from OpenClaw.` };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}`, messages: [] };
      }
    }
    case "openclaw_abort": {
      try {
        const result = await openclawAbort();
        return result.ok ? { message: "OpenClaw run aborted." } : { error: result.error, message: "Could not abort." };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}` };
      }
    }
    case "create_reminder": {
      const msg = typeof a.message === "string" ? (a.message as string).trim() : "";
      if (!msg) return { error: "message is required" };
      const asTask = a.taskType === "assistant_task";
      if (asTask && !conversationId) return { error: "Cannot schedule an assistant task without a conversation (use in chat)." };
      let runAt: number;
      if (typeof a.at === "string" && (a.at as string).trim()) {
        const t = Date.parse((a.at as string).trim());
        if (Number.isNaN(t)) return { error: "at must be a valid ISO 8601 date string" };
        runAt = t;
      } else if (typeof a.inMinutes === "number" && (a.inMinutes as number) > 0) {
        runAt = Date.now() + Math.min((a.inMinutes as number), 60 * 24 * 365) * 60 * 1000;
      } else {
        return { error: "Either at (ISO date) or inMinutes (number) is required" };
      }
      if (runAt <= Date.now()) return { error: "Reminder time must be in the future" };
      const id = crypto.randomUUID();
      const taskType = asTask ? ("assistant_task" as const) : ("message" as const);
      const reminder = {
        id,
        runAt,
        message: msg,
        conversationId: conversationId ?? null,
        taskType,
        status: "pending" as const,
        createdAt: Date.now(),
        firedAt: null,
      };
      await db.insert(reminders).values(toReminderRow(reminder)).run();
      scheduleReminder(id);
      return {
        id,
        runAt,
        reminderMessage: msg,
        taskType,
        status: "pending",
        createdAt: reminder.createdAt,
        message: asTask ? "Scheduled task set. The assistant will run this in the chat when it's time." : "Reminder set. You'll see it in this chat when it fires.",
      };
    }
    case "list_reminders": {
      const status = (a.status === "fired" || a.status === "cancelled" ? a.status : "pending") as "pending" | "fired" | "cancelled";
      const rows = await db.select().from(reminders).where(eq(reminders.status, status)).orderBy(desc(reminders.runAt));
      return { reminders: rows.map(fromReminderRow), message: `${rows.length} reminder(s).` };
    }
    case "cancel_reminder": {
      const rid = typeof a.id === "string" ? (a.id as string).trim() : "";
      if (!rid) return { error: "id is required" };
      const rRows = await db.select().from(reminders).where(eq(reminders.id, rid));
      if (rRows.length === 0) return { error: "Reminder not found" };
      if (rRows[0].status !== "pending") return { error: "Reminder is not pending (already fired or cancelled)" };
      await db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, rid)).run();
      cancelReminderTimeout(rid);
      return { message: "Reminder cancelled." };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${name}: ${msg}`);
  }
}

const DEFAULT_RECENT_SUMMARIES_COUNT = 3;
const MIN_SUMMARIES = 1;
const MAX_SUMMARIES = 10;
/** Number of last messages (user + assistant) to include per recent conversation so the user can reference "the output" or "what you said". */
const LAST_MESSAGES_PER_RECENT_CHAT = 6;

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

  const continueShellApproval = payload.continueShellApproval as { command?: string; stdout?: string; stderr?: string; exitCode?: number } | undefined;
  const hasContinueShellApproval =
    continueShellApproval != null &&
    typeof continueShellApproval === "object" &&
    typeof (continueShellApproval.command ?? "") === "string" &&
    (continueShellApproval.command ?? "").trim() !== "";

  if (!userMessage && !isCredentialReply && !hasContinueShellApproval) return json({ error: "message required" }, { status: 400 });
  if (hasContinueShellApproval && !conversationId) return json({ error: "conversationId required when using continueShellApproval" }, { status: 400 });

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

  return runSerializedByConversation(conversationId, async () => {
  // When user submits credentials, save to vault (only when vault is unlocked)
  if (isCredentialReply && credentialResponse?.credentialKey && credentialResponse.save) {
    const key = String(credentialResponse.credentialKey).trim().toLowerCase().replace(/\s+/g, "_") || "credential";
    const plaintext = credentialResponse.value!.trim();
    await setStoredCredential(key, plaintext, true, vaultKey);
  }

  const bypassRunResponse = payload.bypassRunResponse === true;

  // Option 3: when a run is waiting for user input, inject runWaitingContext so the Chat assistant can decide
  // to call respond_to_run or take another action. No auto-routing — messages always go to the assistant.
  let runWaitingContext: string | undefined;
  if (!bypassRunResponse && !isCredentialReply && conversationId) {
    const waitingRows = await db
      .select({ id: executions.id, targetId: executions.targetId, output: executions.output })
      .from(executions)
      .where(and(eq(executions.status, "waiting_for_user"), eq(executions.conversationId, conversationId)))
      .orderBy(desc(executions.startedAt))
      .limit(1);
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
        `runId: ${runId}`,
        `targetId: ${waitingRows[0].targetId ?? "unknown"}`,
        question ? `question: ${question}` : "",
        optionsList.length > 0 ? `options: ${optionsList.join(", ")}` : "",
      ].filter(Boolean);
      parts.push("raw output (JSON): " + JSON.stringify(inner ?? current ?? {}));
      runWaitingContext = parts.join("\n");
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
    return json({ error: "No LLM provider configured. Go to LLM Settings to add one." }, { status: 400 });
  }
  const configsWithSecret = configRows.map(fromLlmConfigRowWithSecret);
  let llmConfig: (typeof configsWithSecret)[0] | undefined;
  if (providerId) {
    llmConfig = configsWithSecret.find((c) => c.id === providerId);
    if (!llmConfig) {
      return json({ error: "Selected provider not found or was removed." }, { status: 400 });
    }
  } else {
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

  /** Build a callLLM wrapper that records usage and optionally records trace + streams trace_step events. */
  function createTrackingCallLLM(opts: {
    pushTrace?: (entry: LLMTraceCall) => void;
    enqueueTraceStep?: (step: { phase: string; label?: string; messageCount?: number; contentPreview?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }) => void;
  }) {
    return async (req: Parameters<typeof manager.chat>[1]) => {
      opts.enqueueTraceStep?.({ phase: "llm_request", label: "Calling LLM…", messageCount: req.messages.length });
      const response = await manager.chat(llmConfig as LLMConfig, req, { source: "chat" });
      usageEntries.push({ response });
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
      const contentStr = typeof response.content === "string" ? response.content : "";
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
        contentPreview: contentStr.slice(0, 200),
        usage: response.usage,
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

  const streamRequested = request.url.includes("stream=1") || request.headers.get("accept")?.includes("text/event-stream");

  if (streamRequested) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: contentToStore, createdAt: Date.now(), conversationId: conversationId! };
        let generatedTitle: string | null = null;
        const llmTraceEntries: LLMTraceCall[] = [];
        let rephraseTraceEntry: LLMTraceCall | null = null;
        /** Enqueue without throwing when the client disconnected (Controller is already closed). */
        const safeEnqueue = (data: object) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!/already closed|Invalid state/i.test(msg)) throw e;
          }
        };
        const enqueue = safeEnqueue;
        const streamTrackingCallLLM = createTrackingCallLLM({
          pushTrace: (e) => llmTraceEntries.push(e),
          enqueueTraceStep: (step) => enqueue({ type: "trace_step", ...step }),
        });
        let doneSent = false;
        try {
          await db.insert(chatMessages).values(toChatMessageRow(userMsg)).run();

          if (existingRows.length === 0 && !isCredentialReply) {
            enqueue({ type: "trace_step", phase: "title", label: "Generating title…" });
            generatedTitle = await generateConversationTitle((userMessage || contentToStore).trim().slice(0, 2000), manager, llmConfig);
            await db.update(conversations).set({ ...(generatedTitle && { title: generatedTitle }) }).where(eq(conversations.id, conversationId!)).run();
            enqueue({ type: "trace_step", phase: "title_done", label: "Title set" });
          }

          // High-level context preparation step (history, feedback, knowledge, studio resources)
          enqueue({ type: "trace_step", phase: "prepare", label: "Preparing context (history, knowledge, tools)…" });

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
            enqueue({ type: "trace_step", phase: "rephrase_done", label: "Rephrase done" });
            rephrasedPrompt = rephraseResult.rephrasedPrompt;
            if (rephrasedPrompt != null) {
              safeEnqueue({ type: "rephrased_prompt", rephrasedPrompt });
            }
            const trimmed = (userMessage || contentToStore).trim().slice(0, 2000);
            effectiveMessage = rephrasedPrompt ?? trimmed;
            if (rephraseResult.wantsRetry) {
              const allRows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId!)).orderBy(asc(chatMessages.createdAt));
              const lastUserMsg = [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
              if (lastUserMsg) effectiveMessage = lastUserMsg;
            }
          }

          const result = await runAssistant(history, effectiveMessage, {
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
                safeEnqueue({ type: "plan", reasoning, todos });
              },
              onStepStart(stepIndex, todoLabel, toolName, subStepLabel) {
                safeEnqueue({ type: "step_start", stepIndex, todoLabel, toolName, ...(subStepLabel != null && { subStepLabel }) });
              },
              onToolDone(index) {
                safeEnqueue({ type: "todo_done", index });
              },
            },
          });

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
            result.toolResults.map(async (r) => {
              let res = r.result;
              if (r.name === "get_agent" || r.name === "create_agent" || r.name === "update_agent") {
                res = await enrichAgentToolResult(r.result, r.args);
              }
              return { id: crypto.randomUUID(), name: r.name, arguments: r.args, result: res };
            })
          );
          const assistantToolCalls =
            result.toolResults.length > 0 || planToolCall
              ? [...enrichedToolResults, ...(planToolCall ? [planToolCall] : [])]
              : undefined;
          const fullLlmTrace = rephraseTraceEntry ? [rephraseTraceEntry, ...llmTraceEntries] : llmTraceEntries;
          const displayContent = getAssistantDisplayContent(result.content, result.toolResults);
          const turnStatus = getTurnStatusFromToolResults(result.toolResults);
          const assistantMsg = {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: displayContent || getAskUserQuestionFromToolResults(result.toolResults) || "",
            toolCalls: assistantToolCalls,
            llmTrace: fullLlmTrace.length > 0 ? fullLlmTrace : undefined,
            ...(rephrasedPrompt != null && rephrasedPrompt.trim() && { rephrasedPrompt }),
            createdAt: Date.now(),
            conversationId,
          };
          await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();

          // Mark done before sending so we don't send an error event if the client already disconnected (safeEnqueue no-ops).
          doneSent = true;
          safeEnqueue({
            type: "done",
            content: displayContent,
            toolResults: result.toolResults,
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
              safeEnqueue({ type: "error", error: msg, messageId: assistantErrorMsg.id, userMessageId: userMsg.id });
            } catch (persistErr) {
              safeEnqueue({ type: "error", error: msg });
            }
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Stream may already be closed (e.g. client disconnected)
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
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

    const result = await runAssistant(history, effectiveMessage, {
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
      result.toolResults.map(async (r) => {
        let res = r.result;
        if (r.name === "get_agent" || r.name === "create_agent" || r.name === "update_agent") {
          res = await enrichAgentToolResult(r.result, r.args);
        }
        return { id: crypto.randomUUID(), name: r.name, arguments: r.args, result: res };
      })
    );
    const assistantToolCalls =
      result.toolResults.length > 0 || planToolCall
        ? [...enrichedToolResults, ...(planToolCall ? [planToolCall] : [])]
        : undefined;
    const fullLlmTrace = rephraseTraceEntry ? [rephraseTraceEntry, ...llmTraceEntries] : llmTraceEntries;
    const displayContent = getAssistantDisplayContent(result.content, result.toolResults);
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: displayContent || getAskUserQuestionFromToolResults(result.toolResults) || "",
      toolCalls: assistantToolCalls,
      llmTrace: fullLlmTrace.length > 0 ? fullLlmTrace : undefined,
      ...(rephrasedPrompt != null && rephrasedPrompt.trim() && { rephrasedPrompt }),
      createdAt: Date.now(),
      conversationId,
    };
    await db.insert(chatMessages).values(toChatMessageRow(assistantMsg)).run();
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
      toolResults: result.toolResults,
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
    return json({ error: msg }, { status: 500 });
  }
  });
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
