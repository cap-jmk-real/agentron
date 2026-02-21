/**
 * Shared types and helpers for execute-tool handlers.
 * Avoids circular dependencies between execute-tool.ts and handler modules.
 */
import type { getRegistry } from "@agentron-studio/runtime";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  db,
  tools,
  sandboxes,
  workflows,
  executions,
  fromSandboxRow,
  toSandboxRow,
  fromToolRow,
  fromExecutionRow,
  ensureStandardTools,
} from "../../_lib/db";
import { getContainerManager } from "../../_lib/container-manager";
import { layoutNodesByGraph } from "../../../lib/canvas-layout";

export type ExecuteToolContext = {
  conversationId?: string;
  vaultKey?: Buffer | null;
  registry?: ReturnType<typeof getRegistry>;
};

/** Resolve workflow id from args: workflowId, id, or workflowIdentifierField "id" + workflowIdentifierValue. No name-based resolution. */
export function resolveWorkflowIdFromArgs(
  a: Record<string, unknown>
): { workflowId: string } | { error: string } {
  const direct = (a.workflowId ?? a.id) as string | undefined;
  if (typeof direct === "string" && direct.trim()) return { workflowId: direct.trim() };
  const field =
    typeof a.workflowIdentifierField === "string"
      ? (a.workflowIdentifierField as string).trim().toLowerCase()
      : "";
  const value =
    typeof a.workflowIdentifierValue === "string"
      ? (a.workflowIdentifierValue as string).trim()
      : "";
  if (!value)
    return {
      error:
        "Workflow id is required (pass workflowId, id, or workflowIdentifierField 'id' + workflowIdentifierValue).",
    };
  if (field === "id") return { workflowId: value };
  return {
    error:
      "Workflow id is required (pass workflowId, id, or workflowIdentifierField 'id' + workflowIdentifierValue).",
  };
}

/** In-memory session overrides keyed by scopeKey (runId or conversationId). */
export const sessionOverridesStore = new Map<
  string,
  { overrideType: string; payload: unknown }[]
>();

/** Max tools per agent when creating via create_agent. */
export const MAX_TOOLS_PER_CREATED_AGENT = 10;

const RUNNER_NODE_NAME = "agentron-runner-node";
const RUNNER_PYTHON_NAME = "agentron-runner-python";
const RUNNER_NODE_IMAGE = "node:22-slim";
const RUNNER_PYTHON_IMAGE = "python:3.12-slim";

export async function ensureRunnerSandboxId(language: string): Promise<string> {
  const lang = language.toLowerCase();
  const isPython = lang === "python";
  const name = isPython ? RUNNER_PYTHON_NAME : RUNNER_NODE_NAME;
  const image = isPython ? RUNNER_PYTHON_IMAGE : RUNNER_NODE_IMAGE;
  const podman = getContainerManager();
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.name, name)).limit(1);
  if (rows.length > 0) {
    const sb = fromSandboxRow(rows[0]);
    if (!sb.containerId || sb.status !== "running") {
      const newContainerId = await podman.create(image, `${name}-${sb.id}`, { network: true });
      await db
        .update(sandboxes)
        .set({ status: "running", containerId: newContainerId })
        .where(eq(sandboxes.id, sb.id))
        .run();
    }
    return sb.id;
  }
  const id = `runner-${name}-${Date.now()}`;
  const containerId = await podman.create(image, `${name}-${id}`, { network: true });
  await db
    .insert(sandboxes)
    .values(
      toSandboxRow({
        id,
        name,
        image,
        status: "running",
        containerId,
        config: {},
        createdAt: Date.now(),
      })
    )
    .run();
  return id;
}

export type GraphNode = {
  id: string;
  type?: string;
  position: [number, number];
  parameters?: Record<string, unknown>;
};
export type GraphEdge = { id: string; source: string; target: string };

export function applyAgentGraphLayout(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[]
): GraphNode[] {
  if (graphNodes.length === 0) return graphNodes;
  return layoutNodesByGraph({
    items: graphNodes,
    getNodeId: (n) => n.id,
    edges: graphEdges,
    setPosition: (n, x, y) => ({ ...n, position: [x, y] }),
  });
}

export function ensureLlmNodesHaveSystemPrompt(
  graphNodes: {
    id: string;
    type?: string;
    position: [number, number];
    parameters?: Record<string, unknown>;
  }[],
  fallback: string | undefined
): void {
  const defaultPrompt =
    "You are a helpful assistant. Follow the user's instructions and respond clearly.";
  const prompt = typeof fallback === "string" && fallback.trim() ? fallback.trim() : defaultPrompt;
  for (const node of graphNodes) {
    if (node.type !== "llm") continue;
    if (!node.parameters || typeof node.parameters !== "object") node.parameters = {};
    const current = node.parameters.systemPrompt;
    if (typeof current !== "string" || !current.trim()) {
      node.parameters.systemPrompt = prompt;
    }
  }
}

export function ensureToolNodesInGraph(
  graphNodes: {
    id: string;
    type?: string;
    position: [number, number];
    parameters?: Record<string, unknown>;
  }[],
  graphEdges: { id: string; source: string; target: string }[],
  toolIds: string[]
): void {
  if (!Array.isArray(toolIds) || toolIds.length === 0) return;
  const existingToolIds = new Set(
    graphNodes
      .filter(
        (n) =>
          n.type === "tool" &&
          n.parameters &&
          typeof (n.parameters as { toolId?: string }).toolId === "string"
      )
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

export type AgentLearningConfig = {
  maxDerivedGood?: number;
  maxDerivedBad?: number;
  minCombinedFeedback?: number;
  recentExecutionsLimit?: number;
};

const DEFAULT_MAX_DERIVED_GOOD = 20;
const DEFAULT_MAX_DERIVED_BAD = 20;
const DEFAULT_MIN_COMBINED_FEEDBACK = 1;
const DEFAULT_RECENT_EXECUTIONS_LIMIT = 50;

export function resolveLearningConfig(
  agentDefinition: Record<string, unknown> | undefined,
  toolArgs: {
    maxDerivedGood?: number;
    maxDerivedBad?: number;
    minCombinedFeedback?: number;
    recentExecutionsLimit?: number;
  }
): Required<AgentLearningConfig> {
  const fromAgent =
    agentDefinition?.learningConfig != null &&
    typeof agentDefinition.learningConfig === "object" &&
    !Array.isArray(agentDefinition.learningConfig)
      ? (agentDefinition.learningConfig as AgentLearningConfig)
      : {};
  return {
    maxDerivedGood: toolArgs.maxDerivedGood ?? fromAgent.maxDerivedGood ?? DEFAULT_MAX_DERIVED_GOOD,
    maxDerivedBad: toolArgs.maxDerivedBad ?? fromAgent.maxDerivedBad ?? DEFAULT_MAX_DERIVED_BAD,
    minCombinedFeedback:
      toolArgs.minCombinedFeedback ??
      fromAgent.minCombinedFeedback ??
      DEFAULT_MIN_COMBINED_FEEDBACK,
    recentExecutionsLimit:
      toolArgs.recentExecutionsLimit ??
      fromAgent.recentExecutionsLimit ??
      DEFAULT_RECENT_EXECUTIONS_LIMIT,
  };
}

type TrailStep = { agentId?: string; input?: unknown; output?: unknown; error?: string };

export async function deriveFeedbackFromExecutionHistory(
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
    .where(
      and(eq(executions.targetType, "workflow"), inArray(executions.targetId, [...workflowIds]))
    )
    .orderBy(desc(executions.startedAt))
    .limit(recentExecutionsLimit);
  const derived: import("@agentron-studio/core").Feedback[] = [];
  let goodCount = 0;
  let badCount = 0;
  for (const row of execRows) {
    const run = fromExecutionRow(row);
    const out =
      run.output && typeof run.output === "object" && !Array.isArray(run.output)
        ? (run.output as Record<string, unknown>)
        : null;
    const trail = Array.isArray(out?.trail) ? (out.trail as TrailStep[]) : [];
    if (
      run.status === "failed" &&
      out &&
      (out.error || (out as { success?: boolean }).success === false)
    ) {
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

export function getNested(obj: unknown, path: string): unknown {
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

export const TEMPLATE_VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\.\s*([^}]+)\s*\}\}/g;

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

export async function enrichAgentToolResult(
  result: unknown,
  args?: Record<string, unknown>
): Promise<unknown> {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return result;
  const obj = result as Record<string, unknown>;
  if (obj.error != null) return result;
  let ids: string[] = [];
  if (Array.isArray(obj.toolIds))
    ids = (obj.toolIds as unknown[]).filter((x): x is string => typeof x === "string");
  const def = obj.definition;
  if (def != null && typeof def === "object" && !Array.isArray(def)) {
    const defObj = def as Record<string, unknown>;
    if (Array.isArray(defObj.toolIds))
      ids = [
        ...ids,
        ...(defObj.toolIds as unknown[]).filter((x): x is string => typeof x === "string"),
      ];
  }
  if (Array.isArray(args?.toolIds))
    ids = [
      ...ids,
      ...(args.toolIds as unknown[]).filter((x): x is string => typeof x === "string"),
    ];
  ids = [...new Set(ids)];
  if (ids.length === 0) return result;
  await ensureStandardTools();
  const rows = await db
    .select({ id: tools.id, name: tools.name })
    .from(tools)
    .where(inArray(tools.id, ids));
  const toolList = rows.map((r) => ({ id: r.id, name: r.name }));
  return { ...obj, tools: toolList };
}
