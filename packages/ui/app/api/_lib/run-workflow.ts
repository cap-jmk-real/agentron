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
import type { Workflow, Agent, LLMConfig, Canvas } from "@agentron-studio/core";
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
  executions,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
  fromLlmConfigRowWithSecret,
  fromModelPricingRow,
  toTokenUsageRow,
  ensureStandardTools,
  STANDARD_TOOLS,
} from "./db";

export const WAITING_FOR_USER_MESSAGE = "WAITING_FOR_USER";

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
    if (id in STD_IDS) {
      const tool = STANDARD_TOOLS.find((t) => t.id === id) ?? { id, name: id, protocol: "native" as const, config: {}, inputSchema: { type: "object", properties: {}, required: [] } };
      const inputSchema = "inputSchema" in tool ? tool.inputSchema : { type: "object", properties: {}, required: [] };
      const schema = (typeof inputSchema === "object" && inputSchema !== null ? inputSchema : { type: "object", properties: {}, required: [] }) as Record<string, unknown>;
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

/** Error message when the run was cancelled by the user (so callers can set status to "cancelled" instead of "failed"). */
export const RUN_CANCELLED_MESSAGE = "Run cancelled by user";

const WORKFLOW_MEMORY_MAX_RECENT_TURNS = 12;
const GET_WORKFLOW_CONTEXT_TOOL_ID = "get_workflow_context";

function buildWorkflowMemoryBlock(opts: {
  turnInstruction?: string | null;
  summary: string;
  recentTurns: Array<{ speaker: string; text: string }>;
  partnerMessage: string;
  maxRecentTurns?: number;
}): string {
  const { turnInstruction, summary, recentTurns, partnerMessage, maxRecentTurns = WORKFLOW_MEMORY_MAX_RECENT_TURNS } = opts;
  const parts: string[] = [];
  if (turnInstruction && String(turnInstruction).trim()) parts.push(String(turnInstruction).trim());
  if (summary.trim()) parts.push("Summary:\n" + summary.trim() + "\n");
  const turns = recentTurns.slice(-maxRecentTurns);
  if (turns.length > 0) {
    parts.push("Recent turns:\n" + turns.map((t) => `${t.speaker}: ${t.text}`).join("\n"));
  }
  parts.push("Partner just said:\n" + partnerMessage);
  return parts.join("\n\n");
}

export type RunWorkflowOptions = {
  workflowId: string;
  runId: string;
  /** Called after each agent step so the run can be updated with partial trail/output for live UI updates. */
  onStepComplete?: (trail: ExecutionTraceStep[], lastOutput: unknown) => void | Promise<void>;
  /** If provided, checked before each agent step; when it returns true, workflow throws so the run can be marked cancelled. */
  isCancelled?: () => Promise<boolean>;
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
    customPricing[p.modelPattern] = { input: Number(p.inputCostPerM), output: Number(p.outputCostPerM) };
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
    const response = await manager.chat(cfg as LLMConfig, chatReq as Parameters<typeof manager.chat>[1], { source: "workflow" });
    usageEntries.push({ response, agentId: currentAgentId, config: { provider: cfg.provider, model: cfg.model } });
    return response;
  };

  // Normalize edges: canvas uses source/target, engine/handler use from/to
  const edges = (workflow.edges ?? []).map((e: { source?: string; target?: string; from?: string; to?: string }) => ({
    from: e.source ?? e.from ?? "",
    to: e.target ?? e.to ?? "",
  }));

  async function buildToolInstructionsBlock(toolIds: string[]): Promise<string> {
    if (toolIds.length === 0) return "";
    const lines: string[] = [];
    const maxLen = 600;
    for (const id of toolIds) {
      if (STD_IDS[id]) continue;
      const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
      if (rows.length === 0) continue;
      const tool = fromToolRow(rows[0]);
      const cfg = tool.config as { systemPrompt?: string; instructions?: string } | undefined;
      const text = (cfg?.systemPrompt ?? cfg?.instructions ?? "").trim();
      if (text) lines.push(`Tool ${tool.name}: ${text}`);
    }
    const block = lines.join("\n");
    return block.length > maxLen ? block.slice(0, maxLen) + "…" : block;
  }

  const agentHandler = async (
    nodeId: string,
    config: Record<string, unknown> | undefined,
    sharedContext: { get: (k: string) => unknown; set: (k: string, v: unknown) => void; snapshot?: () => Record<string, unknown> }
  ): Promise<unknown> => {
    if (options.isCancelled && (await options.isCancelled())) {
      throw new Error(RUN_CANCELLED_MESSAGE);
    }
    const agentId = config?.agentId as string | undefined;
    if (!agentId) throw new Error(`Workflow node ${nodeId}: missing agentId in config`);

    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
    if (agentRows.length === 0) throw new Error(`Agent not found: ${agentId}`);
    const agent = fromAgentRow(agentRows[0]) as Agent;

    const incoming = edges.filter((e) => e.to === nodeId);
    const fromId = incoming[0]?.from;
    let partnerOutput: unknown = fromId ? sharedContext.get(`__output_${fromId}`) : undefined;
    if (partnerOutput === undefined && !fromId) {
      const prevNodeIndex = (workflow.nodes ?? []).findIndex((n) => n.id === nodeId) - 1;
      const prevNode = prevNodeIndex >= 0 ? (workflow.nodes ?? [])[prevNodeIndex] : undefined;
      partnerOutput = prevNode ? sharedContext.get(`__output_${prevNode.id}`) : undefined;
    }
    const partnerMessage =
      partnerOutput !== undefined
        ? (typeof partnerOutput === "string" ? partnerOutput : JSON.stringify(partnerOutput))
        : "(First turn — start the conversation.)";

    const recentTurns = (sharedContext.get("__recent_turns") as Array<{ speaker: string; text: string }> | undefined) ?? [];
    const summary = (sharedContext.get("__summary") as string | undefined) ?? "";
    const input = buildWorkflowMemoryBlock({
      turnInstruction: workflow.turnInstruction,
      summary,
      recentTurns,
      partnerMessage,
    });

    currentAgentId = agentId;

    const round = sharedContext.get("__round") as number | undefined;
    const step: ExecutionTraceStep = { nodeId, agentId, agentName: agent.name, order: stepOrder++, ...(round !== undefined && { round }), input };

    const workflowContextSnapshot = typeof sharedContext.snapshot === "function" ? sharedContext.snapshot() : {};
    const shared = { ...workflowContextSnapshot } as Record<string, unknown>;

    const def = (agent as Agent & { definition?: { graph?: unknown; toolIds?: string[]; defaultLlmConfigId?: string } }).definition ?? {};
    const toolIds = (def.toolIds ?? []) as string[];
    const defaultLlmConfigId = def.defaultLlmConfigId as string | undefined;
    let availableTools = await buildAvailableTools(toolIds);
    availableTools = [
      ...availableTools,
      {
        type: "function" as const,
        function: {
          name: GET_WORKFLOW_CONTEXT_TOOL_ID,
          description: "Get current workflow context: summary, recent conversation turns, and round index. Call this when you need to see the full conversation so far.",
          parameters: { type: "object" as const, properties: {}, required: [] as string[] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "request_user_help",
          description: "Request help from the user (credentials, 2FA, confirmation, choice). The run pauses until the user responds in Chat or Runs. Use when you need input only the user can provide.",
          parameters: {
            type: "object" as const,
            properties: {
              type: { type: "string", enum: ["credentials", "two_fa", "confirmation", "choice", "other"], description: "Kind of help needed" },
              message: { type: "string", description: "What you need (e.g. 'API key for X')" },
              question: { type: "string", description: "Specific question to show the user" },
            },
            required: ["message"] as string[],
          },
        },
      },
    ];

    const toolInstructionsBlock = await buildToolInstructionsBlock(toolIds);

    const context = {
      sharedContext: shared,
      availableTools,
      buildToolsForIds: async (ids: string[]) => {
        const base = await buildAvailableTools(ids);
        return [
          ...base,
          {
            type: "function" as const,
            function: {
              name: GET_WORKFLOW_CONTEXT_TOOL_ID,
              description: "Get current workflow context: summary, recent conversation turns, and round index.",
              parameters: { type: "object" as const, properties: {}, required: [] as string[] },
            },
          },
        ];
      },
      ragBlock: "",
      toolInstructionsBlock: toolInstructionsBlock ? `Tool instructions:\n${toolInstructionsBlock}` : "",
      callLLM: async (input: unknown) => {
        const req = (input && typeof input === "object" && "messages" in (input as object))
          ? (input as { llmConfigId?: string; messages: unknown[]; tools?: unknown[] })
          : { messages: [{ role: "user" as const, content: String(input ?? "") }] };
        const res = await trackingCallLLM(req as Parameters<typeof trackingCallLLM>[0]);
        return req.tools && Array.isArray(req.tools) && req.tools.length > 0 ? res : res.content;
      },
      callTool: async (toolId: string, input: unknown, override?: ToolOverride) => {
        if (toolId === GET_WORKFLOW_CONTEXT_TOOL_ID) {
          return {
            summary: sharedContext.get("__summary"),
            recentTurns: sharedContext.get("__recent_turns"),
            round: sharedContext.get("__round"),
          };
        }
        if (toolId === "request_user_help") {
          const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
          const message = (typeof arg.message === "string" ? arg.message : "").trim() || "Need your input";
          const question = (typeof arg.question === "string" ? arg.question : "").trim() || message;
          const type = typeof arg.type === "string" ? arg.type : "other";
          const payload = { question, type, message };
          await db.update(executions).set({
            status: "waiting_for_user",
            output: JSON.stringify(payload),
          }).where(eq(executions.id, runId)).run();
          throw new Error(WAITING_FOR_USER_MESSAGE);
        }
        const toolContext = {
          summary: sharedContext.get("__summary"),
          recentTurns: sharedContext.get("__recent_turns"),
          round: sharedContext.get("__round"),
        };
        const merged =
          input !== null && typeof input === "object"
            ? { ...(input as Record<string, unknown>), _workflowContext: toolContext }
            : { _workflowContext: toolContext, message: input };
        return executeStudioTool(toolId, merged, override);
      },
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
        const rawNodes = rawGraph && typeof rawGraph === "object" && !Array.isArray(rawGraph) && Array.isArray((rawGraph as { nodes?: unknown[] }).nodes) ? (rawGraph as { nodes: unknown[] }).nodes : [];
        const rawEdges = rawGraph && typeof rawGraph === "object" && !Array.isArray(rawGraph) && Array.isArray((rawGraph as { edges?: unknown[] }).edges) ? (rawGraph as { edges: unknown[] }).edges : [];
        const graph = {
          nodes: rawNodes.map((n, i) => {
            const node = n as { id: string; type: string; position?: [number, number]; parameters?: Record<string, unknown> };
            return { ...node, position: node.position ?? ([0, i * 100] as [number, number]) };
          }),
          edges: rawEdges,
        };
        const nodeExecutor = new NodeAgentExecutor();
        output = await nodeExecutor.execute(
          { graph: graph as Canvas, sharedContextKeys: [], toolIds, defaultLlmConfigId },
          input,
          { ...context, prompts: {} as Record<string, PromptTemplate> }
        );
      }
      const turns = (sharedContext.get("__recent_turns") as Array<{ speaker: string; text: string }> | undefined) ?? [];
      turns.push({ speaker: agent.name, text: String(output ?? "") });
      if (turns.length > WORKFLOW_MEMORY_MAX_RECENT_TURNS) turns.splice(0, turns.length - WORKFLOW_MEMORY_MAX_RECENT_TURNS);
      sharedContext.set("__recent_turns", turns);

      step.output = output;
      trail.push(step);
      await options.onStepComplete?.(trail, output);
      return output;
    } catch (err) {
      step.error = err instanceof Error ? err.message : String(err);
      trail.push(step);
      await options.onStepComplete?.(trail, undefined);
      throw err;
    }
  };

  const handlers: Record<string, (nodeId: string, config: Record<string, unknown> | undefined, sharedContext: unknown) => Promise<unknown>> = {
    agent: (nodeId, config, sharedContext) => agentHandler(nodeId, config, sharedContext as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }),
  };

  await ensureStandardTools();
  const engine = new WorkflowEngine();
  const initialContext: Record<string, unknown> = { __recent_turns: [], __summary: "" };
  const result = await engine.execute(workflow, handlers, initialContext);

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
        estimatedCost: cost != null ? String(cost) : null,
      })).run();
    }
  }

  return { ...result, trail };
}
