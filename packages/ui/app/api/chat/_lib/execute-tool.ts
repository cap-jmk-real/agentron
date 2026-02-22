/**
 * Chat executeTool: all tool implementations used by the chat assistant.
 * Extracted from the chat route for maintainability.
 */
import {
  db,
  agents,
  workflows,
  agentVersions,
  workflowVersions,
  tools,
  llmConfigs,
  executions,
  files,
  sandboxes,
  customFunctions,
  feedback,
  conversations,
  chatMessages,
  chatAssistantSettings,
  assistantMemory,
  fromChatAssistantSettingsRow,
  toChatAssistantSettingsRow,
  fromAssistantMemoryRow,
  toAssistantMemoryRow,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
  fromLlmConfigRow,
  fromLlmConfigRowWithSecret,
  fromFeedbackRow,
  fromFileRow,
  fromSandboxRow,
  fromCustomFunctionRow,
  toAgentRow,
  toWorkflowRow,
  toToolRow,
  toCustomFunctionRow,
  toSandboxRow,
  toChatMessageRow,
  fromChatMessageRow,
  fromRemoteServerRow,
  toRemoteServerRow,
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
  ensureStandardTools,
  TOOL_CATEGORIES,
  IMPROVEMENT_SUBSETS,
  remoteServers,
} from "../../_lib/db";
import type { RemoteServer } from "../../_lib/db";
import {
  runWriteFile,
  runContainerBuild,
  runContainer,
  runContainerSession,
} from "../../_lib/run-workflow";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { enqueueWorkflowResume } from "../../_lib/workflow-queue";
import { getDeploymentCollectionId, retrieveChunks } from "../../_lib/rag";
import { ragConnectors, ragDocuments } from "@agentron-studio/core";
import {
  browseLocalPath,
  browseGoogleDrive,
  browseDropbox,
  browseOneDrive,
  browseNotion,
  browseConfluence,
  browseGitBook,
  browseBookStack,
} from "../../rag/connectors/_lib/browse";
import { readConnectorItem, updateConnectorItem } from "../../rag/connectors/_lib/connector-write";
import { ingestOneDocument } from "../../rag/ingest/route";
import { testRemoteConnection } from "../../_lib/remote-test";
import { randomAgentName, randomWorkflowName } from "../../_lib/naming";
import { openclawSend, openclawHistory, openclawAbort } from "../../_lib/openclaw-client";
import { eq, asc, desc, and, isNotNull } from "drizzle-orm";
import {
  createDefaultLLMManager,
  refinePrompt,
  getRegistry,
  getSpecialistOptions,
} from "@agentron-studio/runtime";
import { getContainerManager, withContainerInstallHint } from "../../_lib/container-manager";
import { getShellCommandAllowlist, updateAppSettings } from "../../_lib/app-settings";
import { getStoredCredential, setStoredCredential } from "../../_lib/credential-store";
import { createRunNotification } from "../../_lib/notifications-store";
import { scheduleReminder, cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { runShellCommand } from "../../_lib/shell-exec";
import { loadSpecialistOverrides, saveSpecialistOverrides } from "../../_lib/specialist-overrides";

import {
  type ExecuteToolContext,
  sessionOverridesStore,
  MAX_TOOLS_PER_CREATED_AGENT,
  ensureRunnerSandboxId,
  resolveWorkflowIdFromArgs,
  applyAgentGraphLayout,
  ensureLlmNodesHaveSystemPrompt,
  ensureToolNodesInGraph,
  type AgentLearningConfig,
  resolveLearningConfig,
  deriveFeedbackFromExecutionHistory,
  getNested,
  resolveTemplateVars,
  enrichAgentToolResult,
} from "./execute-tool-shared";

export {
  MAX_TOOLS_PER_CREATED_AGENT,
  type AgentLearningConfig,
  resolveTemplateVars,
  enrichAgentToolResult,
} from "./execute-tool-shared";
export { getNested } from "./execute-tool-shared";

import {
  runWorkflow,
  RUN_CANCELLED_MESSAGE,
  WAITING_FOR_USER_MESSAGE,
  WaitingForUserError,
} from "../../_lib/run-workflow";
import { executeToolHandlersWorkflowsRunsReminders } from "./execute-tool-handlers-workflows-runs-reminders";

type GraphNode = import("./execute-tool-shared").GraphNode;
type GraphEdge = import("./execute-tool-shared").GraphEdge;

const CONNECTOR_AUTH_HINT =
  " Configure this connector in Knowledge → Connectors and set the required credential (env var or key).";

function appendConnectorAuthHint(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();
  if (
    /auth|credential|env var|token|service account|unauthorized|401|403|not set|missing.*key|invalid.*key/i.test(
      lower
    )
  ) {
    return errorMessage + CONNECTOR_AUTH_HINT;
  }
  return errorMessage;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: ExecuteToolContext
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
      case "get_specialist_options": {
        const reg = ctx?.registry;
        if (!reg) return { error: "Heap registry not available (call only in heap mode)." };
        const specialistId =
          typeof a.specialistId === "string" && (a.specialistId as string).trim()
            ? (a.specialistId as string).trim()
            : undefined;
        return getSpecialistOptions(reg, specialistId);
      }
      case "apply_session_override": {
        const scopeKey =
          typeof a.scopeKey === "string" && (a.scopeKey as string).trim()
            ? (a.scopeKey as string).trim()
            : undefined;
        const overrideType =
          typeof a.overrideType === "string" && (a.overrideType as string).trim()
            ? (a.overrideType as string).trim()
            : undefined;
        const payload =
          a.payload != null && typeof a.payload === "object" && !Array.isArray(a.payload)
            ? a.payload
            : {};
        if (!scopeKey || !overrideType) return { error: "scopeKey and overrideType are required." };
        const list = sessionOverridesStore.get(scopeKey) ?? [];
        list.push({ overrideType, payload });
        sessionOverridesStore.set(scopeKey, list);
        return { ok: true, message: "Session override applied for scope " + scopeKey + "." };
      }
      case "list_specialists": {
        const reg = ctx?.registry;
        if (!reg) return { error: "Heap registry not available (call only in heap mode)." };
        const specialists = Object.entries(reg.specialists).map(([id, e]) => ({
          id,
          description: e.description,
        }));
        return { specialists };
      }
      case "register_specialist": {
        const id =
          typeof a.id === "string" && (a.id as string).trim() ? (a.id as string).trim() : undefined;
        const description =
          typeof a.description === "string" ? (a.description as string).trim() : "";
        const toolNames = Array.isArray(a.toolNames)
          ? (a.toolNames as string[]).filter((x) => typeof x === "string").slice(0, 10)
          : [];
        if (!id) return { error: "id is required." };
        const overrides = loadSpecialistOverrides();
        if (overrides.some((e) => e.id === id))
          return { error: "Specialist id already exists: " + id + "." };
        overrides.push({ id, description, toolNames });
        saveSpecialistOverrides(overrides);
        return { ok: true, message: "Registered specialist " + id + "." };
      }
      case "update_specialist": {
        const id =
          typeof a.id === "string" && (a.id as string).trim() ? (a.id as string).trim() : undefined;
        if (!id) return { error: "id is required." };
        const overrides = loadSpecialistOverrides();
        const desc =
          typeof a.description === "string" ? (a.description as string).trim() : undefined;
        const toolNames = Array.isArray(a.toolNames)
          ? (a.toolNames as string[]).filter((x) => typeof x === "string").slice(0, 10)
          : undefined;
        let entry = overrides.find((e) => e.id === id);
        if (!entry) {
          const defaultReg = getRegistry();
          const defaultEntry = defaultReg.specialists[id];
          entry = defaultEntry
            ? {
                id,
                description: defaultEntry.description ?? "",
                toolNames: [...defaultEntry.toolNames],
              }
            : { id, description: "", toolNames: [] };
          overrides.push(entry);
        }
        if (desc !== undefined) entry.description = desc;
        if (toolNames !== undefined) entry.toolNames = toolNames;
        saveSpecialistOverrides(overrides);
        return { ok: true, message: "Updated specialist " + id + "." };
      }
      case "ask_user": {
        const question = typeof a.question === "string" ? a.question.trim() : "";
        const reason = typeof a.reason === "string" ? (a.reason as string).trim() : undefined;
        const options = Array.isArray(a.options)
          ? (a.options as unknown[])
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              .map((s) => s.trim())
          : undefined;
        const stepIndex =
          typeof a.stepIndex === "number" && Number.isInteger(a.stepIndex)
            ? a.stepIndex
            : undefined;
        const stepTotal =
          typeof a.stepTotal === "number" && Number.isInteger(a.stepTotal)
            ? a.stepTotal
            : undefined;
        return {
          waitingForUser: true,
          question: question || "Please provide the information or confirmation.",
          ...(options && options.length > 0 ? { options } : {}),
          ...(reason ? { reason } : {}),
          ...(stepIndex != null ? { stepIndex } : {}),
          ...(stepTotal != null ? { stepTotal } : {}),
        };
      }
      case "ask_credentials": {
        const question =
          typeof a.question === "string"
            ? a.question.trim()
            : "Please enter the requested credential.";
        const credentialKey =
          typeof a.credentialKey === "string"
            ? (a.credentialKey as string).trim().toLowerCase().replace(/\s+/g, "_")
            : "";
        if (!credentialKey)
          return {
            waitingForUser: true,
            credentialRequest: true,
            question: "Please provide a credential key.",
            credentialKey: "credential",
          };
        const plaintext = await getStoredCredential(credentialKey, vaultKey);
        if (plaintext != null && plaintext !== "") {
          return { credentialProvided: true, value: plaintext };
        }
        return {
          waitingForUser: true,
          credentialRequest: true,
          question: question || "Please enter the requested credential.",
          credentialKey,
        };
      }
      case "format_response": {
        const summary = typeof a.summary === "string" ? (a.summary as string).trim() : "";
        const needsInput =
          typeof a.needsInput === "string" && (a.needsInput as string).trim()
            ? (a.needsInput as string).trim()
            : undefined;
        return { formatted: true, summary: summary || "", needsInput };
      }
      case "retry_last_message": {
        if (!conversationId) return { lastUserMessage: null, message: "No conversation context." };
        const allRows = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, conversationId))
          .orderBy(asc(chatMessages.createdAt));
        const lastUserMsg = [...allRows].reverse().find((r) => r.role === "user")?.content ?? null;
        if (!lastUserMsg)
          return {
            lastUserMessage: null,
            message: "No previous user message in this conversation.",
          };
        return {
          lastUserMessage: lastUserMsg,
          message: "Use this as the message to respond to. Reply to it now in your response.",
        };
      }
      case "list_agents": {
        const rows = await db.select().from(agents);
        return rows
          .map(fromAgentRow)
          .map((a) => ({ id: a.id, name: a.name, kind: a.kind, protocol: a.protocol }));
      }
      case "list_llm_providers": {
        const rows = await db.select().from(llmConfigs);
        return rows
          .map(fromLlmConfigRow)
          .map((c) => ({ id: c.id, provider: c.provider, model: c.model }));
      }
      case "create_agent": {
        let toolIds = Array.isArray(a.toolIds)
          ? (a.toolIds as string[]).filter((x) => typeof x === "string")
          : undefined;
        if (toolIds && toolIds.length > MAX_TOOLS_PER_CREATED_AGENT) {
          return {
            error: `This agent would have ${toolIds.length} tools, which exceeds the maximum of ${MAX_TOOLS_PER_CREATED_AGENT} tools per agent. Create multiple agents (each with at most ${MAX_TOOLS_PER_CREATED_AGENT} tools) and connect them with a workflow (e.g. pipeline or chat loop).`,
            code: "TOOL_CAP_EXCEEDED",
            maxToolsPerAgent: MAX_TOOLS_PER_CREATED_AGENT,
          };
        }
        const id = crypto.randomUUID();
        const agentName = a.name && String(a.name).trim() ? (a.name as string) : randomAgentName();
        const def: Record<string, unknown> = {};
        const topLevelSystemPrompt =
          typeof a.systemPrompt === "string" && a.systemPrompt.trim()
            ? (a.systemPrompt as string).trim()
            : undefined;
        if (topLevelSystemPrompt) def.systemPrompt = topLevelSystemPrompt;
        if (Array.isArray(a.graphNodes) && a.graphNodes.length > 0) {
          const graphNodes = a.graphNodes as {
            id: string;
            type?: string;
            position: [number, number];
            parameters?: Record<string, unknown>;
          }[];
          const graphEdges = (Array.isArray(a.graphEdges) ? a.graphEdges : []) as {
            id: string;
            source: string;
            target: string;
          }[];
          ensureLlmNodesHaveSystemPrompt(
            graphNodes,
            topLevelSystemPrompt ?? (def.systemPrompt as string | undefined)
          );
          if (!toolIds || toolIds.length === 0) {
            const fromGraph = graphNodes
              .filter(
                (n) =>
                  n.type === "tool" &&
                  n.parameters &&
                  typeof (n.parameters as { toolId?: string }).toolId === "string"
              )
              .map((n) => (n.parameters as { toolId: string }).toolId);
            if (fromGraph.length > 0) toolIds = [...new Set(fromGraph)];
          }
          ensureToolNodesInGraph(graphNodes, graphEdges, toolIds ?? []);
          def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
        } else if (topLevelSystemPrompt && (a.kind as string) !== "code") {
          const nid = `n-${crypto.randomUUID().slice(0, 8)}`;
          const graphNodes: {
            id: string;
            type?: string;
            position: [number, number];
            parameters?: Record<string, unknown>;
          }[] = [
            {
              id: nid,
              type: "llm",
              position: [100, 100],
              parameters: { systemPrompt: topLevelSystemPrompt },
            },
          ];
          const graphEdges: { id: string; source: string; target: string }[] = [];
          ensureToolNodesInGraph(graphNodes, graphEdges, toolIds ?? []);
          def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
        } else if (
          (a.kind as string) !== "code" &&
          !def.graph &&
          ((toolIds?.length ?? 0) > 0 || (a.llmConfigId as string | undefined))
        ) {
          // Caller provided toolIds/llmConfigId but no systemPrompt or graph — avoid creating an empty agent that does nothing when run
          const nid = `n-${crypto.randomUUID().slice(0, 8)}`;
          const desc =
            a.description && String(a.description).trim() ? String(a.description).trim() : "";
          const systemPrompt =
            desc ||
            "You are an assistant. Use the available tools to complete the user request. Respond with a brief summary.";
          const graphNodes: GraphNode[] = [
            { id: nid, type: "llm", position: [100, 100], parameters: { systemPrompt } },
          ];
          const graphEdges: GraphEdge[] = [];
          ensureToolNodesInGraph(graphNodes, graphEdges, toolIds ?? []);
          def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
        }
        if (toolIds && toolIds.length > MAX_TOOLS_PER_CREATED_AGENT) {
          return {
            error: `This agent would have ${toolIds.length} tools, which exceeds the maximum of ${MAX_TOOLS_PER_CREATED_AGENT} tools per agent. Create multiple agents (each with at most ${MAX_TOOLS_PER_CREATED_AGENT} tools) and connect them with a workflow (e.g. pipeline or chat loop).`,
            code: "TOOL_CAP_EXCEEDED",
            maxToolsPerAgent: MAX_TOOLS_PER_CREATED_AGENT,
          };
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
        const hasDef =
          "systemPrompt" in def ||
          "graph" in def ||
          "toolIds" in def ||
          "defaultLlmConfigId" in def;
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
        await db
          .insert(agents)
          .values(toAgentRow(agent as import("@agentron-studio/core").Agent))
          .run();
        return {
          id,
          name: agent.name,
          message: `Agent "${agent.name}" created`,
          toolIds: toolIds?.length,
          llmConfig: !!llmConfig,
        };
      }
      case "get_agent": {
        const agentId = a.id as string;
        const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
        if (agentRows.length === 0) return { error: "Agent not found" };
        return fromAgentRow(agentRows[0]);
      }
      case "update_agent": {
        const id = (a.agentId ?? a.id) as string;
        if (!id || typeof id !== "string" || !id.trim())
          return { error: "agentId or id is required" };
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
          rawDef != null && typeof rawDef === "object" && !Array.isArray(rawDef)
            ? (rawDef as Record<string, unknown>)
            : {};
        if (a.systemPrompt !== undefined) def.systemPrompt = a.systemPrompt;
        if (Array.isArray(a.toolIds))
          def.toolIds = (a.toolIds as string[]).filter((x) => typeof x === "string");
        if (a.llmConfigId) def.defaultLlmConfigId = a.llmConfigId as string;
        if (
          a.learningConfig != null &&
          typeof a.learningConfig === "object" &&
          !Array.isArray(a.learningConfig)
        ) {
          const incoming = a.learningConfig as AgentLearningConfig;
          const existing =
            def.learningConfig != null &&
            typeof def.learningConfig === "object" &&
            !Array.isArray(def.learningConfig)
              ? (def.learningConfig as AgentLearningConfig)
              : {};
          def.learningConfig = {
            ...existing,
            ...(incoming.maxDerivedGood !== undefined && {
              maxDerivedGood: incoming.maxDerivedGood,
            }),
            ...(incoming.maxDerivedBad !== undefined && { maxDerivedBad: incoming.maxDerivedBad }),
            ...(incoming.minCombinedFeedback !== undefined && {
              minCombinedFeedback: incoming.minCombinedFeedback,
            }),
            ...(incoming.recentExecutionsLimit !== undefined && {
              recentExecutionsLimit: incoming.recentExecutionsLimit,
            }),
          };
        }
        if (Array.isArray(a.graphNodes) || Array.isArray(a.graphEdges)) {
          const existingGraph = def.graph;
          const graphNodes =
            existingGraph != null &&
            typeof existingGraph === "object" &&
            !Array.isArray(existingGraph) &&
            Array.isArray((existingGraph as { nodes?: unknown[] }).nodes)
              ? (
                  existingGraph as {
                    nodes: {
                      id: string;
                      type?: string;
                      position: [number, number];
                      parameters?: Record<string, unknown>;
                    }[];
                  }
                ).nodes
              : [];
          const graphEdges =
            existingGraph != null &&
            typeof existingGraph === "object" &&
            !Array.isArray(existingGraph) &&
            Array.isArray((existingGraph as { edges?: unknown[] }).edges)
              ? (existingGraph as { edges: { id: string; source: string; target: string }[] }).edges
              : [];
          if (Array.isArray(a.graphNodes)) {
            const nodes = a.graphNodes as {
              id: string;
              type?: string;
              position: [number, number];
              parameters?: Record<string, unknown>;
            }[];
            const fallback =
              typeof a.systemPrompt === "string" && a.systemPrompt.trim()
                ? (a.systemPrompt as string).trim()
                : (def.systemPrompt as string | undefined);
            ensureLlmNodesHaveSystemPrompt(nodes, fallback);
            graphNodes.length = 0;
            graphNodes.push(...nodes);
          }
          if (Array.isArray(a.graphEdges)) {
            graphEdges.length = 0;
            graphEdges.push(...(a.graphEdges as { id: string; source: string; target: string }[]));
          }
          let updateToolIds = Array.isArray(a.toolIds)
            ? (a.toolIds as string[]).filter((x) => typeof x === "string")
            : (def.toolIds as string[] | undefined);
          const fromGraph = graphNodes
            .filter(
              (n) =>
                n.type === "tool" &&
                n.parameters &&
                typeof (n.parameters as { toolId?: string }).toolId === "string"
            )
            .map((n) => (n.parameters as { toolId: string }).toolId);
          updateToolIds = [...new Set([...(updateToolIds ?? []), ...fromGraph])];
          if (updateToolIds.length > 0) {
            ensureToolNodesInGraph(graphNodes, graphEdges, updateToolIds);
            def.toolIds = updateToolIds;
          }
          def.graph = { nodes: applyAgentGraphLayout(graphNodes, graphEdges), edges: graphEdges };
        } else if (Array.isArray(a.toolIds) && a.toolIds.length > 0) {
          const existingGraph = def.graph;
          if (
            existingGraph != null &&
            typeof existingGraph === "object" &&
            !Array.isArray(existingGraph)
          ) {
            const graphNodes = Array.isArray((existingGraph as { nodes?: unknown[] }).nodes)
              ? (
                  existingGraph as {
                    nodes: {
                      id: string;
                      type?: string;
                      position: [number, number];
                      parameters?: Record<string, unknown>;
                    }[];
                  }
                ).nodes
              : [];
            const graphEdges = Array.isArray((existingGraph as { edges?: unknown[] }).edges)
              ? (existingGraph as { edges: { id: string; source: string; target: string }[] }).edges
              : [];
            if (graphNodes.length > 0) {
              const toolIds = (a.toolIds as string[]).filter((x) => typeof x === "string");
              ensureToolNodesInGraph(graphNodes, graphEdges, toolIds);
              def.graph = {
                nodes: applyAgentGraphLayout(graphNodes, graphEdges),
                edges: graphEdges,
              };
            }
          }
        }
        (updated as { definition?: unknown }).definition = def;
        const currentRow = rows[0];
        const versionRows = await db
          .select({ version: agentVersions.version })
          .from(agentVersions)
          .where(eq(agentVersions.agentId, id))
          .orderBy(desc(agentVersions.version))
          .limit(1);
        const nextVersion = versionRows.length > 0 ? versionRows[0].version + 1 : 1;
        const versionId = crypto.randomUUID();
        const snapshot = JSON.stringify(currentRow);
        await db
          .insert(agentVersions)
          .values({
            id: versionId,
            agentId: id,
            version: nextVersion,
            snapshot,
            createdAt: Date.now(),
            conversationId: conversationId ?? null,
          })
          .run();
        await db.update(agents).set(toAgentRow(updated)).where(eq(agents.id, id)).run();
        return { id, message: `Agent "${updated.name}" updated`, version: nextVersion };
      }
      case "delete_agent": {
        await db
          .delete(agents)
          .where(eq(agents.id, a.id as string))
          .run();
        return { message: "Agent deleted" };
      }
      case "list_agent_versions": {
        const agentId = (a.agentId ?? a.id) as string;
        if (!agentId?.trim()) return { error: "agentId is required" };
        const exists = await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.id, agentId))
          .limit(1);
        if (exists.length === 0) return { error: "Agent not found" };
        const rows = await db
          .select({
            id: agentVersions.id,
            version: agentVersions.version,
            createdAt: agentVersions.createdAt,
          })
          .from(agentVersions)
          .where(eq(agentVersions.agentId, agentId))
          .orderBy(desc(agentVersions.version));
        return rows.map((r) => ({ id: r.id, version: r.version, created_at: r.createdAt }));
      }
      case "rollback_agent": {
        const agentId = (a.agentId ?? a.id) as string;
        if (!agentId?.trim()) return { error: "agentId is required" };
        const versionId = a.versionId as string | undefined;
        const versionNum = typeof a.version === "number" ? a.version : undefined;
        const exists = await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.id, agentId))
          .limit(1);
        if (exists.length === 0) return { error: "Agent not found" };
        let versionRow:
          | { id: string; agentId: string; version: number; snapshot: string }
          | undefined;
        if (versionId) {
          const rows = await db
            .select()
            .from(agentVersions)
            .where(eq(agentVersions.id, versionId))
            .limit(1);
          versionRow =
            rows.length > 0 && rows[0].agentId === agentId
              ? (rows[0] as { id: string; agentId: string; version: number; snapshot: string })
              : undefined;
        } else if (versionNum != null) {
          const rows = await db
            .select()
            .from(agentVersions)
            .where(eq(agentVersions.agentId, agentId));
          versionRow = rows.find((r) => r.version === versionNum) as
            | { id: string; agentId: string; version: number; snapshot: string }
            | undefined;
        }
        if (!versionRow) return { error: "Version not found (provide versionId or version)" };
        let snapshot: Record<string, unknown>;
        try {
          snapshot = JSON.parse(versionRow.snapshot) as Record<string, unknown>;
        } catch {
          return { error: "Invalid snapshot" };
        }
        if (String(snapshot.id) !== agentId) return { error: "Snapshot does not match agent" };
        await db
          .update(agents)
          .set(snapshot as Record<string, unknown>)
          .where(eq(agents.id, agentId))
          .run();
        return { id: agentId, version: versionRow.version, message: "Agent rolled back" };
      }
      case "apply_agent_prompt_improvement": {
        const agentId = a.agentId as string;
        const autoApply = a.autoApply === true;
        const includeExecutionHistory = a.includeExecutionHistory !== false;
        const toolLearningArgs = {
          maxDerivedGood: typeof a.maxDerivedGood === "number" ? a.maxDerivedGood : undefined,
          maxDerivedBad: typeof a.maxDerivedBad === "number" ? a.maxDerivedBad : undefined,
          minCombinedFeedback:
            typeof a.minCombinedFeedback === "number" ? a.minCombinedFeedback : undefined,
          recentExecutionsLimit:
            typeof a.recentExecutionsLimit === "number" ? a.recentExecutionsLimit : undefined,
        };

        const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
        if (agentRows.length === 0) return { error: "Agent not found" };
        const agent = fromAgentRow(agentRows[0]);
        const definition = (agent as { definition?: Record<string, unknown> }).definition ?? {};
        const defObj =
          typeof definition === "object" && definition !== null && !Array.isArray(definition)
            ? (definition as Record<string, unknown>)
            : {};
        const learningConfig = resolveLearningConfig(defObj, toolLearningArgs);
        const currentSystemPrompt = (definition as { systemPrompt?: string }).systemPrompt ?? "";
        const currentSteps = (
          definition as { steps?: { name: string; type: string; content: string }[] }
        ).steps;

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
            error:
              "No feedback or run history to refine from. Add labeled feedback for this agent or run workflows that use this agent.",
          };
        }

        let llmConfig: import("@agentron-studio/core").LLMConfig;
        if (agent.llmConfig && typeof agent.llmConfig === "object") {
          llmConfig = agent.llmConfig as import("@agentron-studio/core").LLMConfig;
        } else {
          const configRows = await db.select().from(llmConfigs);
          if (configRows.length === 0)
            return { error: "No LLM configured for this agent or globally" };
          llmConfig = fromLlmConfigRowWithSecret(
            configRows[0]
          ) as import("@agentron-studio/core").LLMConfig;
        }

        const manager = createDefaultLLMManager(async (ref) =>
          ref ? process.env[ref] : undefined
        );
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
          const defObj =
            typeof def === "object" && def !== null && !Array.isArray(def)
              ? (def as Record<string, unknown>)
              : {};
          const graph = defObj.graph;
          const graphObj =
            graph != null && typeof graph === "object" && !Array.isArray(graph)
              ? (graph as Record<string, unknown>)
              : {};
          const graphNodes = Array.isArray(graphObj.nodes)
            ? (graphObj.nodes as {
                id: string;
                type?: string;
                position: [number, number];
                parameters?: Record<string, unknown>;
              }[])
            : [];
          const graphEdges = Array.isArray(graphObj.edges)
            ? (graphObj.edges as { id: string; source: string; target: string }[])
            : [];
          const newDef: Record<string, unknown> = {
            ...defObj,
            systemPrompt: result.suggestedSystemPrompt,
          };
          ensureLlmNodesHaveSystemPrompt(graphNodes, result.suggestedSystemPrompt);
          newDef.graph = {
            nodes: graphNodes.length > 0 ? graphNodes : (graphObj.nodes ?? []),
            edges: graphEdges,
          };
          const updated = { ...agent, definition: newDef };
          await db
            .update(agents)
            .set(toAgentRow(updated as import("@agentron-studio/core").Agent))
            .where(eq(agents.id, agentId))
            .run();
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
        let result = rows
          .map(fromToolRow)
          .map((t) => ({ id: t.id, name: t.name, protocol: t.protocol }));
        const category =
          typeof a.category === "string" ? (a.category as string).trim().toLowerCase() : undefined;
        let subset =
          typeof a.subset === "string" ? (a.subset as string).trim().toLowerCase() : undefined;
        if (category === "improvement" && !subset) {
          subset = "prompt_and_topology";
        }
        if (category) {
          const inCategory = new Set(
            Object.entries(TOOL_CATEGORIES)
              .filter(([, c]) => c === category)
              .map(([id]) => id)
          );
          result = result.filter((t) => inCategory.has(t.id));
          if (category === "improvement" && subset && IMPROVEMENT_SUBSETS[subset]) {
            const subsetIds = new Set(IMPROVEMENT_SUBSETS[subset]);
            result = result.filter((t) => subsetIds.has(t.id));
          }
        }
        return result;
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
          if (a.inputSchema !== undefined)
            updated.inputSchema = a.inputSchema as Record<string, unknown>;
          if (a.outputSchema !== undefined)
            updated.outputSchema = a.outputSchema as Record<string, unknown>;
        } else {
          if (a.name !== undefined) updated.name = a.name as string;
          if (a.config !== undefined && typeof a.config === "object")
            updated.config = a.config as Record<string, unknown>;
          if (a.inputSchema !== undefined)
            updated.inputSchema = a.inputSchema as Record<string, unknown>;
        }
        await db.update(tools).set(toToolRow(updated)).where(eq(tools.id, toolId)).run();
        return { id: toolId, message: `Tool "${updated.name}" updated` };
      }
      case "create_tool": {
        const id = crypto.randomUUID();
        const config = (
          a.config && typeof a.config === "object" ? (a.config as Record<string, unknown>) : {}
        ) as Record<string, unknown>;
        const tool = {
          id,
          name: a.name && String(a.name).trim() ? (a.name as string) : "Unnamed tool",
          protocol: ((a.protocol as string) || "native") as "native" | "http" | "mcp",
          config,
          inputSchema: a.inputSchema as Record<string, unknown> | undefined,
          outputSchema: a.outputSchema as Record<string, unknown> | undefined,
        };
        await db.insert(tools).values(toToolRow(tool)).run();
        return {
          id,
          name: tool.name,
          message: `Tool "${tool.name}" created. You can edit it at Tools in the sidebar.`,
        };
      }
      case "list_workflows": {
        const rows = await db.select().from(workflows);
        return rows
          .map(fromWorkflowRow)
          .map((w) => ({ id: w.id, name: w.name, executionMode: w.executionMode }));
      }
      case "get_workflow": {
        const wfResolved = resolveWorkflowIdFromArgs(a);
        if ("error" in wfResolved) return { error: wfResolved.error };
        const wfId = wfResolved.workflowId;
        const rows = await db.select().from(workflows).where(eq(workflows.id, wfId));
        if (rows.length === 0) return { error: "Workflow not found" };
        const w = fromWorkflowRow(rows[0]);
        const wNodes = Array.isArray(w.nodes) ? w.nodes : [];
        const wEdges = Array.isArray(w.edges) ? w.edges : [];
        return {
          id: w.id,
          name: w.name,
          executionMode: w.executionMode,
          nodes: wNodes,
          edges: wEdges,
          maxRounds: w.maxRounds,
          turnInstruction: (w as { turnInstruction?: string | null }).turnInstruction,
          branches: (w as { branches?: unknown }).branches,
        };
      }
      case "add_workflow_edges": {
        const wfResolved = resolveWorkflowIdFromArgs(a);
        if ("error" in wfResolved) return { error: wfResolved.error };
        const wfId = wfResolved.workflowId;
        const newEdges = Array.isArray(a.edges)
          ? (a.edges as { id: string; source: string; target: string }[])
          : [];
        const newNodes = Array.isArray(a.nodes)
          ? (a.nodes as {
              id: string;
              type: string;
              position: [number, number];
              parameters?: Record<string, unknown>;
            }[])
          : [];
        const rows = await db.select().from(workflows).where(eq(workflows.id, wfId));
        if (rows.length === 0) return { error: "Workflow not found" };
        const existing = fromWorkflowRow(rows[0]);
        const existingNodes = Array.isArray(existing.nodes)
          ? (existing.nodes as {
              id: string;
              type: string;
              position: [number, number];
              parameters?: Record<string, unknown>;
            }[])
          : [];
        type EdgeWithData = { id: string; source: string; target: string } & Record<
          string,
          unknown
        >;
        const existingEdges = Array.isArray(existing.edges)
          ? (existing.edges as EdgeWithData[])
          : [];
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
        if (a.turnInstruction !== undefined)
          (merged as { turnInstruction?: string | null }).turnInstruction =
            a.turnInstruction === null ? null : String(a.turnInstruction);
        await db.update(workflows).set(toWorkflowRow(merged)).where(eq(workflows.id, wfId)).run();
        return {
          id: wfId,
          message: `Added ${newEdges.length} edge(s) to workflow`,
          nodes: mergedNodes.length,
          edges: mergedEdges.length,
        };
      }
      case "create_workflow": {
        const id = crypto.randomUUID();
        const wfName = a.name && String(a.name).trim() ? (a.name as string) : randomWorkflowName();
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
        // Accept both flat (nodes, edges, maxRounds) and nested (workflow: { nodes, edges, maxRounds }) so workflows are not left empty when the LLM sends the nested shape.
        const w = (a as { workflow?: Record<string, unknown> }).workflow;
        if (w != null && typeof w === "object" && !Array.isArray(w)) {
          if (a.nodes === undefined && Array.isArray(w.nodes))
            (a as Record<string, unknown>).nodes = w.nodes;
          if (a.edges === undefined && Array.isArray(w.edges))
            (a as Record<string, unknown>).edges = w.edges;
          if (a.maxRounds === undefined && w.maxRounds != null)
            (a as Record<string, unknown>).maxRounds = w.maxRounds;
          if (a.name === undefined && w.name != null) (a as Record<string, unknown>).name = w.name;
          if (a.branches === undefined && w.branches !== undefined)
            (a as Record<string, unknown>).branches = w.branches;
        }
        const wfResolved = resolveWorkflowIdFromArgs(a);
        if ("error" in wfResolved) return { error: wfResolved.error };
        const wfId = wfResolved.workflowId;
        const rows = await db.select().from(workflows).where(eq(workflows.id, wfId));
        if (rows.length === 0) return { error: "Workflow not found" };
        const row = rows[0];
        const existing = row != null ? fromWorkflowRow(row) : null;
        const base =
          existing != null && typeof existing === "object"
            ? existing
            : {
                id: wfId,
                name: "",
                description: undefined,
                nodes: [] as unknown[],
                edges: [] as unknown[],
                executionMode: "one_time" as const,
                schedule: undefined,
                maxRounds: undefined,
              };
        const updated: Record<string, unknown> = { ...base };
        if (a.name != null) updated.name = String(a.name);
        if (a.executionMode != null)
          updated.executionMode = a.executionMode as "one_time" | "continuous" | "interval";
        if (a.schedule !== undefined)
          updated.schedule = a.schedule === null ? undefined : String(a.schedule);
        if (a.maxRounds != null) updated.maxRounds = Number(a.maxRounds);
        if (a.turnInstruction !== undefined)
          updated.turnInstruction = a.turnInstruction === null ? null : String(a.turnInstruction);
        if (a.branches !== undefined)
          updated.branches = Array.isArray(a.branches) ? a.branches : undefined;
        let updateWorkflowWarning: string | undefined;
        if (Array.isArray(a.nodes)) {
          const normalizedNodes: {
            id: string;
            type: string;
            position: [number, number];
            parameters: Record<string, unknown>;
          }[] = [];
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
            const position: [number, number] =
              Array.isArray(pos) &&
              pos.length >= 2 &&
              typeof pos[0] === "number" &&
              typeof pos[1] === "number"
                ? [pos[0], pos[1]]
                : [0, 0];
            const params = (n as { parameters?: unknown }).parameters;
            let parameters: Record<string, unknown> = {};
            if (params != null && typeof params === "object" && !Array.isArray(params)) {
              try {
                parameters = { ...(params as Record<string, unknown>) };
              } catch {
                parameters = {};
              }
            }
            const nodeRecord = n as Record<string, unknown>;
            if (!parameters.agentId && parameters.agentName != null) {
              const byName = await db
                .select()
                .from(agents)
                .where(eq(agents.name, String(parameters.agentName)));
              if (byName.length > 0) parameters.agentId = byName[0].id;
            }
            if (
              parameters.agentId == null &&
              nodeRecord.agentId != null &&
              String(nodeRecord.agentId).trim() !== ""
            ) {
              parameters.agentId = String(nodeRecord.agentId).trim();
            }
            if (
              parameters.agentName == null &&
              nodeRecord.agentName != null &&
              String(nodeRecord.agentName).trim() !== ""
            ) {
              parameters.agentName = String(nodeRecord.agentName).trim();
            }
            normalizedNodes.push({ id: id || `n-${i}`, type, position, parameters });
          }
          if (nonAgentCount > 0) {
            updateWorkflowWarning = `Ignored ${nonAgentCount} node(s) with type other than 'agent'; workflow nodes must be type 'agent'.`;
          }
          const agentNodesWithoutId = normalizedNodes.filter(
            (nd) =>
              !(typeof nd.parameters?.agentId === "string" && nd.parameters.agentId.trim() !== "")
          );
          if (agentNodesWithoutId.length > 0) {
            return {
              error:
                "Workflow has agent node(s) without an agent selected. Set parameters.agentId (or parameters.agentName) for each agent node so the workflow can run.",
            };
          }
          updated.nodes = normalizedNodes;
        }
        if (Array.isArray(a.edges)) {
          const normalizedEdges: Array<
            { id: string; source: string; target: string } & Record<string, unknown>
          > = [];
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
        const workflowPayload = {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          nodes: updated.nodes ?? [],
          edges: updated.edges ?? [],
          executionMode: updated.executionMode,
          schedule: updated.schedule,
          maxRounds: updated.maxRounds,
          turnInstruction: updated.turnInstruction,
          branches: updated.branches,
        };
        const wfVersionRows = await db
          .select({ version: workflowVersions.version })
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, wfId))
          .orderBy(desc(workflowVersions.version))
          .limit(1);
        const nextWfVersion = wfVersionRows.length > 0 ? wfVersionRows[0].version + 1 : 1;
        const wfVersionId = crypto.randomUUID();
        await db
          .insert(workflowVersions)
          .values({
            id: wfVersionId,
            workflowId: wfId,
            version: nextWfVersion,
            snapshot: JSON.stringify(row),
            createdAt: Date.now(),
            conversationId: conversationId ?? null,
          })
          .run();
        await db
          .update(workflows)
          .set(toWorkflowRow(workflowPayload as Parameters<typeof toWorkflowRow>[0]))
          .where(eq(workflows.id, wfId))
          .run();
        const nodeList = Array.isArray(workflowPayload.nodes) ? workflowPayload.nodes : [];
        const edgeList = Array.isArray(workflowPayload.edges) ? workflowPayload.edges : [];
        const result: {
          id: string;
          message: string;
          nodes: number;
          edges: number;
          version?: number;
          warning?: string;
        } = {
          id: wfId,
          message: `Workflow "${updated.name}" updated`,
          nodes: nodeList.length,
          edges: edgeList.length,
          version: nextWfVersion,
        };
        if (updateWorkflowWarning) result.warning = updateWorkflowWarning;
        return result;
      }
      case "list_connectors": {
        const rows = await db.select().from(ragConnectors);
        return rows.map((r) => ({
          id: r.id,
          type: r.type,
          collectionId: r.collectionId,
        }));
      }
      case "ingest_deployment_documents": {
        const collectionId = await getDeploymentCollectionId();
        if (!collectionId) {
          return {
            error:
              "No deployment collection. Create a collection with scope 'deployment' in Knowledge → Collections.",
          };
        }
        const docRows = await db
          .select({ id: ragDocuments.id })
          .from(ragDocuments)
          .where(eq(ragDocuments.collectionId, collectionId));
        let totalChunks = 0;
        const errors: string[] = [];
        for (const row of docRows) {
          try {
            const r = await ingestOneDocument(row.id);
            totalChunks += r.chunks;
          } catch (err) {
            errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return {
          message: `Ingested ${docRows.length} documents, ${totalChunks} chunks.`,
          documents: docRows.length,
          chunks: totalChunks,
          ...(errors.length > 0 ? { errors } : {}),
        };
      }
      case "list_connector_items": {
        const connectorId = a.connectorId as string;
        if (!connectorId) return { error: "connectorId required" };
        const connRows = await db
          .select()
          .from(ragConnectors)
          .where(eq(ragConnectors.id, connectorId));
        if (connRows.length === 0) return { error: "Connector not found" };
        const connector = connRows[0];
        const config = connector.config
          ? (JSON.parse(connector.config) as Record<string, unknown>)
          : {};
        const limit = typeof a.limit === "number" ? Math.min(a.limit, 500) : 200;
        const pageToken = typeof a.pageToken === "string" ? a.pageToken : undefined;
        try {
          if (
            connector.type === "filesystem" ||
            connector.type === "obsidian_vault" ||
            connector.type === "logseq_graph"
          ) {
            const dirPath = config.path as string | undefined;
            if (!dirPath || typeof dirPath !== "string")
              return { error: "Connector has no config.path" };
            const result = browseLocalPath(dirPath, undefined, { limit, pageToken });
            return result;
          }
          if (connector.type === "google_drive") {
            return await browseGoogleDrive(config, { limit, pageToken });
          }
          if (connector.type === "dropbox")
            return await browseDropbox(config, { limit, pageToken });
          if (connector.type === "onedrive") return await browseOneDrive(config, { limit });
          if (connector.type === "notion") return await browseNotion(config, { limit });
          if (connector.type === "confluence") return await browseConfluence(config, { limit });
          if (connector.type === "gitbook") return await browseGitBook(config);
          if (connector.type === "bookstack") return await browseBookStack(config);
          return { error: `Browse not implemented for connector type: ${connector.type}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: appendConnectorAuthHint(msg) };
        }
      }
      case "connector_read_item": {
        const connectorId = a.connectorId as string;
        const itemId = a.itemId as string;
        if (!connectorId || !itemId) return { error: "connectorId and itemId required" };
        const result = await readConnectorItem(connectorId, itemId);
        if ("error" in result) return { error: appendConnectorAuthHint(result.error) };
        return result;
      }
      case "connector_update_item": {
        const connectorId = a.connectorId as string;
        const itemId = a.itemId as string;
        const content = typeof a.content === "string" ? a.content : "";
        if (!connectorId || !itemId) return { error: "connectorId and itemId required" };
        const result = await updateConnectorItem(connectorId, itemId, content);
        if ("error" in result) return { error: appendConnectorAuthHint(result.error) };
        return result;
      }
      default: {
        const result = await executeToolHandlersWorkflowsRunsReminders(name, a, ctx, executeTool);
        if (result !== undefined) return result;
        return { error: `Unknown tool: ${name}` };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${name}: ${msg}`);
  }
}
