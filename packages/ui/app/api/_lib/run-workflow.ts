/**
 * Runs a workflow and returns its output (or throws). Caller is responsible for
 * updating the execution record with status and output.
 */
import { eq } from "drizzle-orm";
import {
  WorkflowEngine,
  NodeAgentExecutor,
  CodeAgentExecutor,
  createDefaultLLMManager,
  resolveModelPricing,
  calculateCost,
  fetchUrl,
  runCode,
  httpRequest,
  webhook,
  weather,
} from "@agentron-studio/runtime";
import type { Workflow, Agent } from "@agentron-studio/core";
import type { PromptTemplate } from "@agentron-studio/core";
import type { LLMResponse } from "@agentron-studio/runtime";
import {
  db,
  agents,
  workflows,
  tools as toolsTable,
  llmConfigs,
  tokenUsage,
  modelPricing,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
  fromLlmConfigRowWithSecret,
  fromModelPricingRow,
  toTokenUsageRow,
  ensureStandardTools,
  STANDARD_TOOLS,
} from "./db";

const STD_IDS: Record<string, (input: unknown) => Promise<unknown>> = {
  "std-fetch-url": fetchUrl,
  "std-browser": fetchUrl,
  "std-run-code": runCode,
  "std-http-request": httpRequest,
  "std-webhook": webhook,
  "std-weather": weather,
};

type ToolOverride = { config?: Record<string, unknown>; inputSchema?: unknown; name?: string };

type LLMToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

async function buildAvailableTools(toolIds: string[]): Promise<LLMToolDef[]> {
  if (toolIds.length === 0) return [];
  const out: LLMToolDef[] = [];
  for (const id of toolIds) {
    const builtin = STD_IDS[id];
    if (builtin) {
      const tool = STANDARD_TOOLS.find((t) => t.id === id) ?? { id, name: id, protocol: "native" as const, config: {}, inputSchema: { type: "object", properties: {}, required: [] } };
      const schema = (typeof tool.inputSchema === "object" && tool.inputSchema !== null ? tool.inputSchema : { type: "object", properties: {}, required: [] }) as Record<string, unknown>;
      out.push({
        type: "function",
        function: {
          name: tool.id,
          description: tool.name,
          parameters: schema,
        },
      });
      continue;
    }
    const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
    if (rows.length === 0) continue;
    const tool = fromToolRow(rows[0]);
    const schema = (typeof tool.inputSchema === "object" && tool.inputSchema !== null ? tool.inputSchema : { type: "object", properties: {}, required: [] }) as Record<string, unknown>;
    out.push({
      type: "function",
      function: {
        name: tool.id,
        description: tool.name,
        parameters: schema,
      },
    });
  }
  return out;
}

async function executeStudioTool(toolId: string, input: unknown, override?: ToolOverride): Promise<unknown> {
  const builtin = STD_IDS[toolId];
  if (builtin) return builtin(input ?? {});

  const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, toolId));
  if (rows.length === 0) return { error: `Tool not found: ${toolId}` };
  const tool = fromToolRow(rows[0]);
  const mergedConfig = { ...(tool.config ?? {}), ...(override?.config ?? {}) };

  if (tool.protocol === "http") {
    const url =
      (mergedConfig as { url?: string }).url ??
      (typeof input === "object" && input !== null && "url" in (input as object) ? (input as { url: string }).url : undefined);
    if (typeof url === "string") return httpRequest({ ...(typeof input === "object" && input !== null ? (input as object) : {}), url });
  }
  const baseToolId = (mergedConfig as { baseToolId?: string })?.baseToolId ?? (tool.config as { baseToolId?: string })?.baseToolId ?? tool.id;
  const std = STD_IDS[baseToolId];
  if (std) return std(input ?? {});
  return { error: `Tool ${toolId} not supported in workflow execution` };
}

export type RunWorkflowOptions = {
  workflowId: string;
  runId: string;
};

export type ExecutionTraceStep = {
  nodeId: string;
  agentId: string;
  agentName: string;
  order: number;
  /** 0-based round index for multi-round workflows (when __round is in sharedContext) */
  round?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
};

type NodeAgentGraph = {
  nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>;
  edges: Array<{ id: string; from: string; to: string }>;
};

export async function runWorkflow(options: RunWorkflowOptions): Promise<{
  output: unknown;
  context: Record<string, unknown>;
  trail: ExecutionTraceStep[];
}> {
  const { workflowId, runId } = options;
  const trail: ExecutionTraceStep[] = [];
  let stepOrder = 0;

  const wfRows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (wfRows.length === 0) throw new Error("Workflow not found");
  const workflow = fromWorkflowRow(wfRows[0]) as Workflow;

  const configRows = await db.select().from(llmConfigs);
  if (configRows.length === 0) throw new Error("No LLM provider configured");
  const configsWithSecret = configRows.map(fromLlmConfigRowWithSecret);
  const llmConfig =
    configsWithSecret.find((c) => (typeof (c as { extra?: { apiKey?: string } }).extra?.apiKey === "string" && (c as { extra?: { apiKey?: string } }).extra!.apiKey!.length > 0) || (typeof (c as { apiKeyRef?: string }).apiKeyRef === "string" && (c as { apiKeyRef?: string }).apiKeyRef!.length > 0)) ??
    configsWithSecret[0];

  const pricingRows = await db.select().from(modelPricing);
  const customPricing: Record<string, { input: number; output: number }> = {};
  for (const r of pricingRows) {
    const p = fromModelPricingRow(r);
    customPricing[p.modelPattern] = { input: p.inputCostPerM, output: p.outputCostPerM };
  }

  const manager = createDefaultLLMManager(async (ref) => (ref ? process.env[ref] : undefined));

  const resolveLlmConfig = (id?: string) => {
    if (!id) return llmConfig;
    const c = configsWithSecret.find((x) => (x as { id?: string }).id === id);
    return c ? (c as { id: string; provider: string; model: string }) : llmConfig;
  };

  let currentAgentId: string | undefined;
  const usageEntries: { response: LLMResponse; agentId?: string; config: { provider: string; model: string } }[] = [];
  const trackingCallLLM = async (req: Parameters<typeof manager.chat>[1] & { llmConfigId?: string }) => {
    const cfg = resolveLlmConfig(req.llmConfigId);
    const { llmConfigId: _drop, ...chatReq } = req as Record<string, unknown>;
    const response = await manager.chat(cfg, chatReq as Parameters<typeof manager.chat>[1], { source: "workflow" });
    usageEntries.push({ response, agentId: currentAgentId, config: { provider: cfg.provider, model: cfg.model } });
    return response;
  };

  const edges = (workflow.edges ?? []) as { from: string; to: string }[];
  const agentHandler = async (
    nodeId: string,
    config: Record<string, unknown> | undefined,
    sharedContext: { get: (k: string) => unknown; set: (k: string, v: unknown) => void; snapshot?: () => Record<string, unknown> }
  ): Promise<unknown> => {
    const agentId = config?.agentId as string | undefined;
    if (!agentId) throw new Error(`Workflow node ${nodeId}: missing agentId in config`);

    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
    if (agentRows.length === 0) throw new Error(`Agent not found: ${agentId}`);
    const agent = fromAgentRow(agentRows[0]) as Agent;

    const incoming = edges.filter((e) => e.to === nodeId);
    const fromId = incoming[0]?.from;
    let input: unknown = fromId ? sharedContext.get(`__output_${fromId}`) : undefined;
    if (input === undefined && !fromId) {
      const prevNodeIndex = (workflow.nodes ?? []).findIndex((n) => n.id === nodeId) - 1;
      const prevNode = prevNodeIndex >= 0 ? (workflow.nodes ?? [])[prevNodeIndex] : undefined;
      input = prevNode ? sharedContext.get(`__output_${prevNode.id}`) : undefined;
    }

    currentAgentId = agentId;

    const round = sharedContext.get<number>("__round");
    const step: ExecutionTraceStep = { nodeId, agentId, agentName: agent.name, order: stepOrder++, ...(round !== undefined && { round }), input };

    // Pass workflow's shared context (previous node outputs) to agent so it can access upstream data on top of its config
    const workflowContextSnapshot = typeof sharedContext.snapshot === "function" ? sharedContext.snapshot() : {};
    const shared = { ...workflowContextSnapshot } as Record<string, unknown>;

    const def = (agent as Agent & { definition?: { graph?: unknown; toolIds?: string[]; defaultLlmConfigId?: string } }).definition ?? {};
    const toolIds = (def.toolIds ?? []) as string[];
    const defaultLlmConfigId = def.defaultLlmConfigId as string | undefined;
    const availableTools = await buildAvailableTools(toolIds);

    const context = {
      sharedContext: shared,
      availableTools,
      buildToolsForIds: async (ids: string[]) => buildAvailableTools(ids),
      callLLM: async (input: unknown) => {
        const req = (input && typeof input === "object" && "messages" in (input as object))
          ? (input as { llmConfigId?: string; messages: unknown[]; tools?: unknown[] })
          : { messages: [{ role: "user" as const, content: String(input ?? "") }] };
        const res = await trackingCallLLM(req);
        return req.tools && Array.isArray(req.tools) && req.tools.length > 0 ? res : res.content;
      },
      callTool: async (toolId: string, input: unknown, override?: ToolOverride) =>
        executeStudioTool(toolId, input ?? {}, override),
    };

    try {
      let output: unknown;
      if (agent.kind === "code") {
        const def = (agent as Agent & { definition?: { source?: string; entrypoint?: string } }).definition ?? {};
        const executor = new CodeAgentExecutor();
        output = await executor.execute(
          { source: def.source ?? "", entrypoint: def.entrypoint ?? "default" },
          input,
          context
        );
      } else {
        const nodeDef = (agent as Agent & { definition?: { graph?: { nodes?: unknown[]; edges?: unknown[] }; toolIds?: string[] } }).definition ?? {};
        const rawGraph = nodeDef.graph;
        const graph = rawGraph && typeof rawGraph === "object" && !Array.isArray(rawGraph)
          ? { nodes: Array.isArray((rawGraph as { nodes?: unknown[] }).nodes) ? (rawGraph as { nodes: unknown[] }).nodes : [], edges: Array.isArray((rawGraph as { edges?: unknown[] }).edges) ? (rawGraph as { edges: unknown[] }).edges : [] }
          : { nodes: [], edges: [] };
        const nodeExecutor = new NodeAgentExecutor();
        output = await nodeExecutor.execute(
          { graph: graph as NodeAgentGraph, sharedContextKeys: [], toolIds, defaultLlmConfigId },
          input,
          { ...context, prompts: {} as Record<string, PromptTemplate> }
        );
      }
      step.output = output;
      trail.push(step);
      return output;
    } catch (err) {
      step.error = err instanceof Error ? err.message : String(err);
      trail.push(step);
      throw err;
    }
  };

  const handlers: Record<string, (nodeId: string, config: Record<string, unknown> | undefined, sharedContext: unknown) => Promise<unknown>> = {
    agent: (nodeId, config, sharedContext) => agentHandler(nodeId, config, sharedContext as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }),
  };

  await ensureStandardTools();
  const engine = new WorkflowEngine();
  const result = await engine.execute(workflow, handlers);

  for (const entry of usageEntries) {
    const usage = entry.response.usage;
    if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
      const pricing = resolveModelPricing(entry.config.model, customPricing);
      const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
      await db.insert(tokenUsage).values(toTokenUsageRow({
        id: crypto.randomUUID(),
        executionId: runId,
        agentId: entry.agentId ?? null,
        workflowId,
        provider: entry.config.provider,
        model: entry.config.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCost: cost,
      })).run();
    }
  }

  return { ...result, trail };
}
