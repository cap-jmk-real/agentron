/**
 * Chat executeTool: all tool implementations used by the chat assistant.
 * Extracted from the chat route for maintainability.
 */
import {
  db, agents, workflows, tools, llmConfigs, executions, files, sandboxes, customFunctions, feedback, conversations, chatMessages, chatAssistantSettings, assistantMemory,
  fromChatAssistantSettingsRow, toChatAssistantSettingsRow, fromAssistantMemoryRow, toAssistantMemoryRow,
  fromAgentRow, fromWorkflowRow, fromToolRow, fromLlmConfigRow, fromLlmConfigRowWithSecret, fromFeedbackRow, fromFileRow, fromSandboxRow,
  toAgentRow, toWorkflowRow, toToolRow, toCustomFunctionRow, toSandboxRow, toChatMessageRow, fromChatMessageRow,
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
  reminders,
  fromReminderRow,
  toReminderRow,
  insertWorkflowMessage,
  getWorkflowMessages,
} from "../../_lib/db";
import type { RemoteServer } from "../../_lib/db";
import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE, WaitingForUserError, runWriteFile, runContainerBuild, runContainer, runContainerSession } from "../../_lib/run-workflow";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { enqueueWorkflowResume } from "../../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../../_lib/rag";
import { testRemoteConnection } from "../../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../../_lib/naming";
import { openclawSend, openclawHistory, openclawAbort } from "../../_lib/openclaw-client";
import { eq, asc, desc, and, inArray, isNotNull } from "drizzle-orm";
import { runAssistant, buildFeedbackInjection, createDefaultLLMManager, resolveModelPricing, calculateCost, searchWeb, fetchUrl, refinePrompt, getRegistry } from "@agentron-studio/runtime";
import { getContainerManager, withContainerInstallHint } from "../../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../../_lib/credential-store";
import { createRunNotification } from "../../_lib/notifications-store";
import { scheduleReminder, cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { layoutNodesByGraph } from "../../../lib/canvas-layout";
import { runShellCommand } from "../../_lib/shell-exec";

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
export async function enrichAgentToolResult(result: unknown, args?: Record<string, unknown>): Promise<unknown> {
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

/** Get nested value by dot path; if missing mid-path (e.g. result.workflow), try last segment on root (e.g. result.id). */
function getNested(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.trim().split(".");
  let v: unknown = obj;
  for (const p of parts) {
    if (v == null || typeof v !== "object") {
      const last = parts[parts.length - 1];
      if (last && parts.length > 1) return (obj as Record<string, unknown>)[last];
      return undefined;
    }
    v = (v as Record<string, unknown>)[p];
  }
  if (v !== undefined) return v;
  const last = parts[parts.length - 1];
  if (last && parts.length > 1) return (obj as Record<string, unknown>)[last];
  return undefined;
}

const TEMPLATE_VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\.\s*([^}]+)\s*\}\}/g;

/** Resolve {{ toolName.path }} in string values using prior tool results (last result per tool name). */
export function resolveTemplateVars(
  args: Record<string, unknown>,
  priorResults: { name: string; result: unknown }[]
): Record<string, unknown> {
  const byName = new Map<string, unknown>();
  for (let i = priorResults.length - 1; i >= 0; i--) {
    const { name, result } = priorResults[i];
    if (!byName.has(name)) byName.set(name, result);
  }
  function resolveVal(val: unknown): unknown {
    if (typeof val === "string") {
      return val.replace(TEMPLATE_VAR_REGEX, (match, toolName: string, path: string) => {
        const result = byName.get(toolName);
        const v = getNested(result, path);
        return v != null ? String(v) : match;
      });
    }
    if (Array.isArray(val)) return val.map(resolveVal);
    if (val != null && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) out[k] = resolveVal(v);
      return out;
    }
    return val;
  }
  return resolveVal(args) as Record<string, unknown>;
}

export async function executeTool(
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
      return { formatted: true, summary: summary || "", needsInput };
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
      const id = (a.agentId ?? a.id) as string;
      if (!id || typeof id !== "string" || !id.trim()) return { error: "agentId or id is required" };
      const rows = await db.select().from(agents).where(eq(agents.id, id.trim()));
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
        const fromGraph = graphNodes
          .filter((n) => n.type === "tool" && n.parameters && typeof (n.parameters as { toolId?: string }).toolId === "string")
          .map((n) => (n.parameters as { toolId: string }).toolId);
        updateToolIds = [...new Set([...(updateToolIds ?? []), ...fromGraph])];
        if (updateToolIds.length > 0) {
          ensureToolNodesInGraph(graphNodes, graphEdges, updateToolIds);
          def.toolIds = updateToolIds;
        }
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
      const wfId = (a.workflowId ?? a.id) as string;
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
      const wfId = (a.workflowId ?? a.id) as string;
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat/route.ts:respond_to_run',message:'respond_to_run invoked',data:{runId,responseLen:response.length},hypothesisId:'H2_H3',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
      enqueueWorkflowResume({ runId, resumeUserResponse: response });
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
    case "get_run_messages": {
      const runIdArg = typeof (a as { runId?: string }).runId === "string" ? (a as { runId: string }).runId.trim() : "";
      if (!runIdArg) return { error: "runId is required" };
      const limit = typeof (a as { limit?: number }).limit === "number" && (a as { limit: number }).limit > 0
        ? Math.min(100, (a as { limit: number }).limit)
        : 50;
      const runRows = await db.select({ id: executions.id }).from(executions).where(eq(executions.id, runIdArg));
      if (runRows.length === 0) return { error: "Run not found" };
      const messages = await getWorkflowMessages(runIdArg, limit);
      return { runId: runIdArg, messages };
    }
    case "get_run_for_improvement": {
      const runIdArg = typeof (a as { runId?: string }).runId === "string" ? (a as { runId: string }).runId.trim() : "";
      if (!runIdArg) return { error: "runId is required. Get a run ID from Runs in the sidebar or from a previous execute_workflow result (use execute_workflow.id)." };
      const includeFullLogs = (a as { includeFullLogs?: boolean }).includeFullLogs === true;
      return getRunForImprovement(runIdArg, { includeFullLogs });
    }
    case "get_feedback_for_scope": {
      const targetIdRaw = typeof (a as { targetId?: string }).targetId === "string" ? (a as { targetId: string }).targetId.trim() : "";
      const agentIdFallback = typeof (a as { agentId?: string }).agentId === "string" ? (a as { agentId: string }).agentId.trim() : "";
      const targetId = targetIdRaw || agentIdFallback;
      if (!targetId) return { error: "targetId or agentId is required" };
      const rawLabel = typeof (a as { label?: string }).label === "string" ? (a as { label: string }).label.trim() : "";
      const label = rawLabel === "good" || rawLabel === "bad" ? rawLabel : undefined;
      const limit = typeof (a as { limit?: number }).limit === "number" && (a as { limit: number }).limit > 0
        ? (a as { limit: number }).limit
        : undefined;
      return getFeedbackForScope(targetId, { label, limit });
    }
    case "execute_workflow": {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat/route.ts:execute_workflow',message:'execute_workflow start',data:{hasVaultKey:!!vaultKey},hypothesisId:'vault_access',timestamp:Date.now()})}).catch(()=>{});
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
        const { output, context, trail } = await runWorkflow({ workflowId, runId, branchId, vaultKey: vaultKey ?? undefined, onStepComplete, onProgress, isCancelled });
        const payload = executionOutputSuccess(output ?? context, trail);
        await db.update(executions).set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
        try {
          createRunNotification(runId, "completed", { targetType: "workflow", targetId: workflowId });
        } catch {
          // ignore
        }
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
          // Preserve execution trail when request_user_help overwrote the run output (so run page shows progress)
          if (err instanceof WaitingForUserError && err.trail.length > 0) {
            try {
              const runRows = await db.select({ output: executions.output }).from(executions).where(eq(executions.id, runId));
              const raw = runRows[0]?.output;
              const parsed = raw == null ? {} : (typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>));
              const merged = { ...parsed, trail: err.trail };
              await db.update(executions).set({ output: JSON.stringify(merged) }).where(eq(executions.id, runId)).run();
            } catch {
              // ignore
            }
          }
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
              question = (q || msg) || (typeof out.question === "string" ? out.question.trim() : undefined);
              const opts = Array.isArray(inner?.suggestions) ? inner.suggestions : Array.isArray(inner?.options) ? inner.options : Array.isArray(out.suggestions) ? out.suggestions : undefined;
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
        try {
          createRunNotification(runId, "failed", { targetType: "workflow", targetId: workflowId });
        } catch {
          // ignore
        }
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
