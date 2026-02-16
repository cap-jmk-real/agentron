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
  httpToolAdapter,
  webhook,
  weather,
  webSearch,
} from "@agentron-studio/runtime";
import type { Workflow, Agent, LLMConfig, Canvas } from "@agentron-studio/core";
import type { PromptTemplate } from "@agentron-studio/core";
import type { LLMResponse } from "@agentron-studio/runtime";
import {
  db,
  agents,
  workflows,
  tools as toolsTable,
  customFunctions,
  sandboxes,
  files,
  llmConfigs,
  tokenUsage,
  modelPricing,
  executions,
  runLogs,
  executionOutputSuccess,
  executionOutputFailure,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
  fromCustomFunctionRow,
  fromSandboxRow,
  fromLlmConfigRowWithSecret,
  fromModelPricingRow,
  toTokenUsageRow,
  toFileRow,
  ensureStandardTools,
  ensureAgentFilesDir,
  STANDARD_TOOLS,
} from "./db";
import { getContainerManager, withContainerInstallHint } from "./container-manager";
import { getWorkflowMaxSelfFixRetries, getMaxFileUploadBytes } from "./app-settings";
import path from "node:path";
import fs from "node:fs";

export const WAITING_FOR_USER_MESSAGE = "WAITING_FOR_USER";

/** True if a tool result indicates failure (error, non-zero exitCode, or HTTP 4xx/5xx). Used for self-fix loop. Exported for tests. */
export function isToolResultFailure(result: unknown): boolean {
  if (result == null || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string" && r.error.trim().length > 0) return true;
  const exitCode = r.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) return true;
  const statusCode = r.statusCode ?? r.status;
  const code = typeof statusCode === "number" ? statusCode : undefined;
  if (code != null && (code >= 400 && code <= 599)) return true;
  return false;
}

export type ContainerStreamChunk = { stdout?: string; stderr?: string; meta?: "container_started" | "container_stopped" };

/** Run a container one-shot (create, exec, destroy). Exported for chat. */
export async function runContainer(input: unknown, onChunk?: (chunk: ContainerStreamChunk) => void): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const image = (arg.image as string)?.trim();
  const rawCommand = arg.command;
  const command =
    typeof rawCommand === "string"
      ? rawCommand.trim()
      : Array.isArray(rawCommand)
        ? rawCommand.map(String).join(" ")
        : "";
  if (!image || !command) {
    const hint =
      typeof input === "string"
        ? "The Run Container tool received text instead of { image, command }. If this agent has an LLM node followed by a tool node, remove the tool node — the LLM calls the tool internally."
        : "image and command are required";
    return { error: hint, stdout: "", stderr: hint, exitCode: -1 };
  }
  const name = `workflow-one-shot-${Date.now()}`;
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
        const hint = withContainerInstallHint(pullMsg);
        return { error: hint !== pullMsg ? hint : `Failed to pull/create: ${pullMsg}`, stdout: "", stderr: pullMsg, exitCode: -1 };
      }
    } else {
      const hint = withContainerInstallHint(msg);
      return { error: hint !== msg ? hint : `Failed to create container: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
    }
  }
  try {
    if (onChunk && typeof (mgr as { execStream?: unknown }).execStream === "function") {
      onChunk({ meta: "container_started" });
      try {
        return await (mgr as { execStream(containerId: string, command: string, onChunk?: (c: ContainerStreamChunk) => void): Promise<{ stdout: string; stderr: string; exitCode: number }> }).execStream(containerId, command, onChunk);
      } finally {
        onChunk({ meta: "container_stopped" });
      }
    }
    return await mgr.exec(containerId, command);
  } finally {
    try {
      await mgr.destroy(containerId);
    } catch {
      /* ignore */
    }
  }
}

/** Run-scoped container session: one container per runId, create once and exec many until destroy or run end. */
const containerSessionByRunId = new Map<string, { containerId: string; image: string }>();

async function destroyContainerSession(runId: string): Promise<void> {
  const session = containerSessionByRunId.get(runId);
  if (!session) return;
  containerSessionByRunId.delete(runId);
  try {
    const mgr = getContainerManager();
    await mgr.destroy(session.containerId);
  } catch {
    /* ignore */
  }
}

/** Run-scoped or conversation-scoped container session. Exported for chat (pass conversationId as runId). */
export async function runContainerSession(
  runId: string,
  input: unknown,
  onChunk?: (chunk: ContainerStreamChunk) => void
): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const action = typeof arg.action === "string" ? arg.action : "";
  const mgr = getContainerManager();
  const isImageNotFound = (m: string) => {
    const s = m.toLowerCase();
    return s.includes("no such image") || s.includes("manifest unknown") || s.includes("not found") || s.includes("pull access denied") || s.includes("unable to find image");
  };

  if (action === "ensure") {
    const image = (arg.image as string)?.trim();
    if (!image) return { error: "image is required for action ensure", stdout: "", stderr: "image is required", exitCode: -1 };
    const existing = containerSessionByRunId.get(runId);
    if (existing) return { containerId: existing.containerId, created: false, image: existing.image };
    const name = `workflow-session-${runId.slice(0, 8)}-${Date.now()}`;
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
          const hint = withContainerInstallHint(pullMsg);
          return { error: hint !== pullMsg ? hint : `Failed to pull/create: ${pullMsg}`, stdout: "", stderr: pullMsg, exitCode: -1 };
        }
      } else {
        const hint = withContainerInstallHint(msg);
        return { error: hint !== msg ? hint : `Failed to create container: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
      }
    }
    containerSessionByRunId.set(runId, { containerId, image });
    return { containerId, created: true, image };
  }

  if (action === "exec") {
    const session = containerSessionByRunId.get(runId);
    if (!session) return { error: "No container session for this run. Call std-container-session with action ensure first.", stdout: "", stderr: "No session", exitCode: -1 };
    const rawCommand = arg.command;
    const command = typeof rawCommand === "string" ? rawCommand.trim() : Array.isArray(rawCommand) ? rawCommand.map(String).join(" ") : "";
    if (!command) return { error: "command is required for action exec", stdout: "", stderr: "command is required", exitCode: -1 };
    if (onChunk && typeof (mgr as { execStream?: unknown }).execStream === "function") {
      return await (mgr as { execStream(containerId: string, command: string, onChunk?: (c: ContainerStreamChunk) => void): Promise<{ stdout: string; stderr: string; exitCode: number }> }).execStream(session.containerId, command, onChunk);
    }
    return await mgr.exec(session.containerId, command);
  }

  if (action === "destroy") {
    await destroyContainerSession(runId);
    return { destroyed: true };
  }

  return { error: `Unknown action: ${action}. Use ensure, exec, or destroy.`, stdout: "", stderr: "Unknown action", exitCode: -1 };
}

/** Build image from Containerfile. Exported for chat. Supports inline dockerfileContent (creates temp context) or contextPath + dockerfilePath. */
export async function runContainerBuild(input: unknown): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const imageTag = typeof arg.imageTag === "string" ? arg.imageTag.trim() : "";
  if (!imageTag) {
    return { error: "imageTag is required", stdout: "", stderr: "Missing imageTag", exitCode: -1 };
  }
  const inlineContent = typeof arg.dockerfileContent === "string" ? arg.dockerfileContent : "";
  let contextPath = typeof arg.contextPath === "string" ? arg.contextPath.trim() : "";
  let dockerfilePath = typeof arg.dockerfilePath === "string" ? arg.dockerfilePath.trim() : "";

  if (inlineContent) {
    const tmpId = `build-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const tmpDir = ensureAgentFilesDir(tmpId);
    const dfPath = path.join(tmpDir, "Containerfile");
    fs.writeFileSync(dfPath, inlineContent, "utf-8");
    contextPath = tmpDir;
    dockerfilePath = path.join(tmpDir, "Containerfile");
  }

  if (!contextPath || !dockerfilePath) {
    return { error: "contextPath and dockerfilePath are required, or provide dockerfileContent", stdout: "", stderr: "Missing required fields", exitCode: -1 };
  }

  const mgr = getContainerManager();
  try {
    await mgr.build(contextPath, dockerfilePath, imageTag);
    return { imageTag, built: true, stdout: "", stderr: "", exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = withContainerInstallHint(msg);
    return { error: hint !== msg ? hint : `Build failed: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
  }
}

/** Write a file to agent-files/{contextId}, insert into files table. Exported for chat. */
export async function runWriteFile(input: unknown, contextId: string): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const name = typeof arg.name === "string" ? arg.name.trim() : "";
  const content = typeof arg.content === "string" ? arg.content : "";
  if (!name) {
    return { error: "name is required", id: null, name: null, path: null, contextDir: null };
  }
  const maxBytes = getMaxFileUploadBytes();
  const buf = Buffer.from(content, "utf-8");
  if (buf.length > maxBytes) {
    return { error: `Content too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`, id: null, name: null, path: null, contextDir: null };
  }
  const dir = ensureAgentFilesDir(contextId);
  const id = crypto.randomUUID();
  const ext = path.extname(name) || "";
  const storedName = `${id}${ext}`;
  const filePath = path.join(dir, storedName);
  fs.writeFileSync(filePath, buf, "utf-8");
  const entry = {
    id,
    name,
    mimeType: "text/plain",
    size: buf.length,
    path: `agent-files/${contextId}/${storedName}`,
    createdAt: Date.now(),
  };
  await db.insert(files).values(toFileRow(entry)).run();
  return { id: entry.id, name: entry.name, path: entry.path, contextDir: dir };
}

const STD_IDS: Record<string, (input: unknown) => Promise<unknown>> = {
  "std-fetch-url": fetchUrl,
  "std-browser": fetchUrl,
  "std-run-code": runCode,
  "std-http-request": httpRequest,
  "std-webhook": webhook,
  "std-weather": weather,
  "std-web-search": webSearch,
  "std-container-run": runContainer,
  "std-container-build": runContainerBuild,
};

/** Execute a custom function (JavaScript/Python) in its sandbox. Used when a tool wraps a custom function. */
async function runCustomFunction(functionId: string, input: unknown): Promise<unknown> {
  const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, functionId));
  if (fnRows.length === 0) return { error: `Custom function not found: ${functionId}` };

  const fn = fromCustomFunctionRow(fnRows[0]);
  if (!fn.sandboxId) return { error: "No sandbox assigned to this function. Assign a sandbox in Tools or Functions." };

  const sbRows = await db.select().from(sandboxes).where(eq(sandboxes.id, fn.sandboxId));
  if (sbRows.length === 0) return { error: "Sandbox not found for this function." };

  const sb = fromSandboxRow(sbRows[0]);
  const containerId = sb.containerId;
  if (!containerId || sb.status !== "running") return { error: "Sandbox is not running. Start the sandbox first." };

  const inputJson = JSON.stringify(input ?? null);
  let command: string;

  switch (fn.language) {
    case "python":
      command = `python3 -c ${JSON.stringify(fn.source + `\nif __name__=="__main__": import json,sys; print(json.dumps(main(json.loads(sys.argv[1] if len(sys.argv)>1 else 'null'))))`)} ${JSON.stringify(inputJson)}`;
      break;
    case "javascript":
    case "typescript":
      command = `node -e ${JSON.stringify(`const input = ${inputJson}; ${fn.source}; if(typeof main==='function') main(input).then(r=>console.log(JSON.stringify(r))).catch(e=>console.error(e));`)}`;
      break;
    default:
      return { error: `Unsupported function language: ${fn.language}` };
  }

  const podman = getContainerManager();
  try {
    const result = await podman.exec(containerId, command);
    if (result.exitCode !== 0) {
      return { error: result.stderr || "Function execution failed", stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    }
    try {
      return JSON.parse(result.stdout.trim() || "null");
    } catch {
      return { output: result.stdout };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

type ToolOverride = { config?: Record<string, unknown>; inputSchema?: unknown; name?: string };

type LLMToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

async function buildAvailableTools(toolIds: string[]): Promise<LLMToolDef[]> {
  if (toolIds.length === 0) return [];
  const out: LLMToolDef[] = [];
  for (const id of toolIds) {
    if (id === "std-request-user-help") continue;
    if (id in STD_IDS) {
      const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
      const tool = rows.length > 0 ? fromToolRow(rows[0]) : STANDARD_TOOLS.find((t) => t.id === id) ?? { id, name: id, protocol: "native" as const, config: {}, inputSchema: { type: "object", properties: {}, required: [] } };
      const inputSchema = typeof (tool as unknown as { inputSchema?: unknown }).inputSchema === "object" && (tool as unknown as { inputSchema?: unknown }).inputSchema !== null ? (tool as unknown as { inputSchema: Record<string, unknown> }).inputSchema : { type: "object", properties: {}, required: [] };
      const schema = inputSchema as Record<string, unknown>;
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
  if (toolId === "std-browser-automation") {
    const { browserAutomation } = await import("./browser-automation");
    return browserAutomation(input ?? {});
  }
  const builtin = STD_IDS[toolId];
  if (builtin) return builtin(input ?? {});

  const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, toolId));
  if (rows.length === 0) return { error: `Tool not found: ${toolId}` };
  const tool = fromToolRow(rows[0]);
  const mergedConfig = { ...(tool.config ?? {}), ...(override?.config ?? {}) };

  if (tool.protocol === "http") {
    const url = (mergedConfig as { url?: string }).url;
    if (url) {
      return httpToolAdapter.execute(
        { ...tool, config: mergedConfig },
        typeof input === "object" && input !== null ? input : {}
      );
    }
    const fallbackUrl =
      typeof input === "object" && input !== null && "url" in (input as object) ? (input as { url: string }).url : undefined;
    if (typeof fallbackUrl === "string") return httpRequest({ ...(typeof input === "object" && input !== null ? (input as object) : {}), url: fallbackUrl });
  }
  const baseToolId = (mergedConfig as { baseToolId?: string })?.baseToolId ?? (tool.config as { baseToolId?: string })?.baseToolId ?? tool.id;
  const std = STD_IDS[baseToolId];
  if (std) return std(input ?? {});

  // Custom functions: tools that wrap JavaScript/Python code in a sandbox
  let functionId: string | undefined =
    (mergedConfig as { functionId?: string })?.functionId ??
    (tool.config as { functionId?: string })?.functionId ??
    (toolId.startsWith("fn-") ? toolId.slice(3) : undefined);
  if (!functionId) {
    // Tool ID may equal function ID (e.g. when tool was registered with function's UUID)
    const fnRows = await db.select({ id: customFunctions.id }).from(customFunctions).where(eq(customFunctions.id, toolId));
    if (fnRows.length > 0) functionId = toolId;
  }
  if (functionId) return runCustomFunction(functionId, input ?? {});

  return { error: `Tool ${toolId} not supported in workflow execution` };
}

/** Error message when the run was cancelled by the user (so callers can set status to "cancelled" instead of "failed"). */
export const RUN_CANCELLED_MESSAGE = "Run cancelled by user";

const WORKFLOW_MEMORY_MAX_RECENT_TURNS = 12;
const GET_WORKFLOW_CONTEXT_TOOL_ID = "get_workflow_context";

const FIRST_TURN_DEFAULT = "(First turn — start the conversation.)";

function buildWorkflowMemoryBlock(opts: {
  turnInstruction?: string | null;
  summary: string;
  recentTurns: Array<{ speaker: string; text: string }>;
  partnerMessage: string;
  precedingAgentName?: string | null;
  maxRecentTurns?: number;
}): string {
  const { turnInstruction, summary, recentTurns, partnerMessage, precedingAgentName, maxRecentTurns = WORKFLOW_MEMORY_MAX_RECENT_TURNS } = opts;
  const hasContext = (turnInstruction && String(turnInstruction).trim()) || summary.trim() || recentTurns.length > 0;
  const isFirstTurnNoContext = !hasContext && (partnerMessage === FIRST_TURN_DEFAULT || partnerMessage.trim() === "");

  if (isFirstTurnNoContext) {
    return "Execute your task.";
  }

  const parts: string[] = [];
  if (turnInstruction && String(turnInstruction).trim()) parts.push(String(turnInstruction).trim());
  if (summary.trim()) parts.push("Summary:\n" + summary.trim() + "\n");
  const turns = recentTurns.slice(-maxRecentTurns);
  if (turns.length > 0) {
    parts.push("Recent turns:\n" + turns.map((t) => `${t.speaker}: ${t.text}`).join("\n"));
  }
  const incomingLabel = precedingAgentName && String(precedingAgentName).trim()
    ? `Output from ${String(precedingAgentName).trim()}:\n`
    : "";
  parts.push(incomingLabel + partnerMessage);
  return parts.join("\n\n");
}

export type RunWorkflowOptions = {
  workflowId: string;
  runId: string;
  /** When set and workflow has branches, run only this branch's graph (nodes/edges/maxRounds/schedule). */
  branchId?: string;
  /** When set, used as the first-turn partner message so the agent continues after user responded to request_user_help. */
  resumeUserResponse?: string;
  /** Called after each agent step so the run can be updated with partial trail/output for live UI updates. */
  onStepComplete?: (trail: ExecutionTraceStep[], lastOutput: unknown) => void | Promise<void>;
  /** Called when run progress changes (workflow started, tool executing) so the UI can show current activity. */
  onProgress?: (state: { message: string; toolId?: string }, currentTrail: ExecutionTraceStep[]) => void | Promise<void>;
  /** If provided, checked before each agent step; when it returns true, workflow throws so the run can be marked cancelled. */
  isCancelled?: () => Promise<boolean>;
  /** When provided, container (std-container-run) stdout/stderr are streamed here for live UI display. */
  onContainerStream?: (runId: string, chunk: ContainerStreamChunk) => void;
  /** Max number of automatic "proceed with fix" continuations per agent step when a tool fails and the agent would request_user_help. 0 = disabled (current behavior). */
  maxSelfFixRetries?: number;
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
  /** Tool invocations in this step (name and short args summary) for debugging. */
  toolCalls?: Array<{ name: string; argsSummary?: string }>;
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
  const { workflowId, runId, branchId, maxSelfFixRetries: maxSelfFixRetriesOption = 0 } = options;
  const trail: ExecutionTraceStep[] = [];
  let stepOrder = 0;

  const wfRows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (wfRows.length === 0) throw new Error("Workflow not found");
  const workflow = fromWorkflowRow(wfRows[0]) as Workflow;

  // Resolve graph: when branchId is set and workflow has that branch, run the branch's graph; else run main graph.
  const branch =
    branchId && Array.isArray(workflow.branches) ? workflow.branches.find((b) => b.id === branchId) : undefined;
  const effectiveNodes = branch ? (branch.nodes ?? []) : (workflow.nodes ?? []);
  const effectiveEdges = branch ? (branch.edges ?? []) : (workflow.edges ?? []);
  const effectiveMaxRounds = branch ? (branch.maxRounds ?? undefined) : (workflow.maxRounds ?? undefined);
  const effectiveTurnInstruction = branch
    ? (branch.turnInstruction ?? workflow.turnInstruction)
    : workflow.turnInstruction;
  const workflowForEngine: Workflow = {
    ...workflow,
    nodes: effectiveNodes,
    edges: effectiveEdges,
    maxRounds: effectiveMaxRounds,
    turnInstruction: effectiveTurnInstruction ?? undefined,
  };

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
  const edges = (workflowForEngine.edges ?? []).map((e: { source?: string; target?: string; from?: string; to?: string }) => ({
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
    let agentId = config?.agentId as string | undefined;
    if (!agentId && config?.agentName != null) {
      const byName = await db.select().from(agents).where(eq(agents.name, String(config.agentName)));
      if (byName.length > 0) agentId = byName[0].id;
    }
    if (!agentId) throw new Error(`Workflow node ${nodeId}: missing agentId in config`);

    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
    if (agentRows.length === 0) throw new Error(`Agent not found: ${agentId}`);
    const agent = fromAgentRow(agentRows[0]) as Agent;
    const agentDef = (agent as Agent & { definition?: { toolIds?: string[] } }).definition ?? {};
    const agentToolIds = (agentDef.toolIds ?? []) as string[];

    const incoming = edges.filter((e) => e.to === nodeId);
    const fromId = incoming[0]?.from;
    let partnerOutput: unknown = fromId ? sharedContext.get(`__output_${fromId}`) : undefined;
    let sourceNodeId: string | undefined = fromId;
    if (partnerOutput === undefined && !fromId) {
      const prevNodeIndex = (workflowForEngine.nodes ?? []).findIndex((n) => n.id === nodeId) - 1;
      const prevNode = prevNodeIndex >= 0 ? (workflowForEngine.nodes ?? [])[prevNodeIndex] : undefined;
      partnerOutput = prevNode ? sharedContext.get(`__output_${prevNode.id}`) : undefined;
      sourceNodeId = prevNode?.id;
    }
    const partnerMessage =
      partnerOutput !== undefined
        ? (typeof partnerOutput === "string" ? partnerOutput : JSON.stringify(partnerOutput))
        : (options.resumeUserResponse !== undefined && options.resumeUserResponse !== ""
          ? options.resumeUserResponse
          : FIRST_TURN_DEFAULT);
    const precedingAgentName = sourceNodeId ? (sharedContext.get(`__agentName_${sourceNodeId}`) as string | undefined) : undefined;

    const recentTurns = (sharedContext.get("__recent_turns") as Array<{ speaker: string; text: string }> | undefined) ?? [];
    const summary = (sharedContext.get("__summary") as string | undefined) ?? "";
    let input = buildWorkflowMemoryBlock({
      turnInstruction: effectiveTurnInstruction ?? undefined,
      summary,
      recentTurns,
      partnerMessage,
      precedingAgentName: precedingAgentName && String(precedingAgentName).trim() ? precedingAgentName : undefined,
    });
    currentAgentId = agentId;

    const round = sharedContext.get("__round") as number | undefined;
    const step: ExecutionTraceStep = { nodeId, agentId, agentName: agent.name, order: stepOrder++, ...(round !== undefined && { round }), input };
    const toolCallsForStep: Array<{ name: string; argsSummary?: string }> = [];
    let lastToolId: string | null = null;
    let lastToolResult: unknown = null;
    let selfFixAttempts = 0;
    const maxSelfFixRetries = Math.max(0, Math.min(10, maxSelfFixRetriesOption));

    function toolArgsSummary(toolId: string, args: unknown): string | undefined {
      if (args == null || typeof args !== "object") return undefined;
      const o = args as Record<string, unknown>;
      if (toolId === "std-container-run") {
        const image = typeof o.image === "string" ? o.image : undefined;
        const cmd = o.command != null ? String(o.command).slice(0, 80) : undefined;
        if (image || cmd) return [image && `image: ${image}`, cmd && `command: ${cmd}`].filter(Boolean).join(", ");
        return undefined;
      }
      if (toolId === "std-container-session") {
        const act = typeof o.action === "string" ? o.action : undefined;
        const image = typeof o.image === "string" ? o.image : undefined;
        const cmd = o.command != null ? String(o.command).slice(0, 80) : undefined;
        if (act) return [act, image && `image: ${image}`, cmd && `command: ${cmd}`].filter(Boolean).join(", ");
        return undefined;
      }
      if (toolId === "std-container-build") {
        const ctx = typeof o.contextPath === "string" ? o.contextPath : undefined;
        const df = typeof o.dockerfilePath === "string" ? o.dockerfilePath : undefined;
        const tag = typeof o.imageTag === "string" ? o.imageTag : undefined;
        if (tag) return [ctx && `context: ${ctx}`, df && `file: ${df}`, `tag: ${tag}`].filter(Boolean).join(", ");
        return undefined;
      }
      if (toolId === "std-write-file") {
        const name = typeof o.name === "string" ? o.name : undefined;
        const len = typeof o.content === "string" ? o.content.length : 0;
        if (name) return `name: ${name}${len ? `, ${len} chars` : ""}`;
        return undefined;
      }
      if (toolId === "std-browser-automation") {
        const act = typeof o.action === "string" ? o.action : undefined;
        const url = typeof o.url === "string" ? o.url : undefined;
        const sel = typeof o.selector === "string" ? o.selector : undefined;
        if (act) return [act, url && `url: ${url.slice(0, 40)}`, sel && `selector: ${sel.slice(0, 30)}`].filter(Boolean).join(", ");
        return undefined;
      }
      if (toolId === "request_user_help") {
        const q = typeof o.question === "string" ? o.question : typeof o.message === "string" ? o.message : undefined;
        const opts = Array.isArray(o.options) ? o.options : Array.isArray(o.suggestions) ? o.suggestions : [];
        const optsPart = opts.length > 0 ? `, ${opts.length} option(s)` : "";
        return q ? `question: ${q}${optsPart}` : undefined;
      }
      return undefined;
    }

    const workflowContextSnapshot = typeof sharedContext.snapshot === "function" ? sharedContext.snapshot() : {};
    const shared = { ...workflowContextSnapshot } as Record<string, unknown>;

    const def = (agent as Agent & { definition?: { graph?: unknown; toolIds?: string[]; defaultLlmConfigId?: string } }).definition ?? {};
    const toolIds = (def.toolIds ?? []) as string[];
    const defaultLlmConfigId = def.defaultLlmConfigId as string | undefined;
    let availableTools = await buildAvailableTools(toolIds);
    const requestUserHelpTool = {
      type: "function" as const,
      function: {
        name: "request_user_help",
        description: "Pause the run so the user can provide input. The run stops until the user responds in Chat or the run page. You MUST pass a concrete, actionable question — never use generic text like 'Please confirm', 'How can I help?', or 'Need your input'. Follow the agent's system prompt: if it defines a template (e.g. 'Which saved searches should I analyze?' with a numbered list), use that template and substitute the actual data (e.g. the list you retrieved). Set 'question' to the full text shown to the user (include any list, instructions, and example reply format). Use 'options' or 'suggestions' for clickable choices (e.g. ['Yes', 'No'] or ['Analyze all', 'Select saved searches', 'Cancel']). If the result contains _selfFixContinue, retry the failed tool and do not call request_user_help again for that retry.",
        parameters: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["credentials", "two_fa", "confirmation", "choice", "other"], description: "Kind of help needed" },
            message: { type: "string", description: "Short internal label for what you need (e.g. 'Vault login for LinkedIn'). Shown as fallback if question is empty." },
            question: { type: "string", description: "REQUIRED: Full question/text shown to the user. Must be concrete and actionable (e.g. include a numbered list of items, how to reply, example format). Do not use generic phrases like 'Please confirm'." },
            suggestions: { type: "array", items: { type: "string" }, description: "Choice strings shown as buttons (e.g. ['Yes', 'No'] or ['1,3', 'Analyze all', 'Cancel'])." },
            options: { type: "array", items: { type: "string" }, description: "Same as suggestions: choice strings for the UI." },
          },
          required: ["message"] as string[],
        },
      },
    };
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
      ...(toolIds.includes("std-request-user-help") ? [requestUserHelpTool] : []),
    ];

    let toolInstructionsBlock = await buildToolInstructionsBlock(toolIds);
    if (toolIds.includes("std-request-user-help")) {
      const requestUserHelpNote = "When calling request_user_help you must set 'question' to a concrete, actionable message (e.g. include a numbered list of items and how to reply). Do not use generic text like 'Please confirm' or 'How can I help?'.";
      toolInstructionsBlock = toolInstructionsBlock ? `${toolInstructionsBlock}\n${requestUserHelpNote}` : requestUserHelpNote;
    }
    if (toolIds.includes("std-browser-automation") && toolIds.includes("std-web-search")) {
      const urlSearchNote = "If a URL does not load or is wrong (e.g. 404, timeout, unreachable), use web search to find the correct URL, then retry browser navigate.";
      toolInstructionsBlock = toolInstructionsBlock ? `${toolInstructionsBlock}\n${urlSearchNote}` : urlSearchNote;
    }

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
        toolCallsForStep.push({ name: toolId, argsSummary: toolArgsSummary(toolId, input) });
        if (toolId === "request_user_help") {
          const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
          const message = (typeof arg.message === "string" ? arg.message : "").trim() || "Need your input";
          const question = (typeof arg.question === "string" ? arg.question : "").trim() || message;
          const type = typeof arg.type === "string" ? arg.type : "other";
          const rawSuggestions = arg.suggestions;
          const rawOptions = arg.options;
          const suggestionsList = Array.isArray(rawSuggestions)
            ? rawSuggestions.filter((s): s is string => typeof s === "string").slice(0, 50)
            : [];
          const optionsList = Array.isArray(rawOptions)
            ? rawOptions.filter((s): s is string => typeof s === "string").slice(0, 50)
            : [];
          const combined = optionsList.length > 0 ? optionsList : suggestionsList;
          const lastToolFailed = lastToolId != null && isToolResultFailure(lastToolResult);
          const isRetryConfirmation = type === "confirmation" || type === "other";
          if (lastToolFailed && selfFixAttempts < maxSelfFixRetries && isRetryConfirmation) {
            selfFixAttempts += 1;
            return {
              _selfFixContinue: true,
              instruction:
                "The last tool call failed. Proceed with your suggested fix: retry the tool with corrected arguments or use another tool as needed. Do not call request_user_help again for this retry.",
            };
          }
          const payload: Record<string, unknown> = { question, type, message, reason: message };
          if (combined.length > 0) {
            payload.suggestions = combined;
            payload.options = combined;
          }
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'run-workflow.ts:request_user_help',message:'writing waiting_for_user payload',data:{runId,questionLen:question?.length??0,optionsLen:combined.length},hypothesisId:'H5',timestamp:Date.now()})}).catch(()=>{});
          // #endregion
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
        let result: unknown;
        if (toolId === "std-container-session") {
          const onChunk = options.onContainerStream ? (chunk: ContainerStreamChunk) => options.onContainerStream!(runId, chunk) : undefined;
          result = await runContainerSession(runId, merged, onChunk);
        } else if (toolId === "std-container-run" && options.onContainerStream) {
          result = await runContainer(merged, (chunk) => options.onContainerStream!(runId, chunk));
        } else if (toolId === "std-write-file") {
          result = await runWriteFile(merged, runId);
        } else {
          try {
            result = await executeStudioTool(toolId, merged, override);
          } catch (toolErr) {
            const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            await db.insert(runLogs).values({
              id: crypto.randomUUID(),
              executionId: runId,
              level: "stderr",
              message: `Tool ${toolId} threw: ${errMsg}`,
              payload: null,
              createdAt: Date.now(),
            }).run();
            throw toolErr;
          }
        }
        const toolErrorMsg =
          result != null && typeof result === "object" && "error" in result && typeof (result as { error: unknown }).error === "string"
            ? (result as { error: string }).error
            : (result != null && typeof result === "object" && (result as { success?: boolean }).success === false && "error" in result && typeof (result as { error: unknown }).error === "string"
              ? (result as { error: string }).error
              : null);
        if (toolErrorMsg) {
          await db.insert(runLogs).values({
            id: crypto.randomUUID(),
            executionId: runId,
            level: "stderr",
            message: `Tool ${toolId}: ${toolErrorMsg}`,
            payload: null,
            createdAt: Date.now(),
          }).run();
        }
        lastToolId = toolId;
        lastToolResult = result;
        return result;
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
      sharedContext.set(`__agentName_${nodeId}`, agent.name);

      step.output = output;
      if (toolCallsForStep.length > 0) step.toolCalls = [...toolCallsForStep];
      trail.push(step);
      await options.onStepComplete?.(trail, output);
      return output;
    } catch (err) {
      step.error = err instanceof Error ? err.message : String(err);
      if (toolCallsForStep.length > 0) step.toolCalls = [...toolCallsForStep];
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
  await options.onProgress?.({ message: "Starting workflow…" }, trail);
  const result = await engine.execute(workflowForEngine, handlers, initialContext);

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

/**
 * Loads a run by id and executes its workflow (used for resume after user response).
 * Updates the run with output/status on completion, WAITING_FOR_USER, or failure.
 */
export async function runWorkflowForRun(
  runId: string,
  opts?: { resumeUserResponse?: string }
): Promise<void> {
  const rows = await db
    .select({ targetId: executions.targetId, targetBranchId: executions.targetBranchId })
    .from(executions)
    .where(eq(executions.id, runId));
  if (rows.length === 0) throw new Error("Run not found");
  const workflowId = rows[0].targetId;
  const branchId = (rows[0].targetBranchId as string | null) ?? undefined;

  const onStepComplete = async (
    trail: ExecutionTraceStep[],
    lastOutput: unknown
  ) => {
    const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
    await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
  };
  const onProgress = async (state: { message: string; toolId?: string }, currentTrail: ExecutionTraceStep[]) => {
    const payload = executionOutputSuccess(undefined, currentTrail.length > 0 ? currentTrail : undefined, state.message);
    await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
  };
  const isCancelled = async () => {
    const r = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, runId));
    return r[0]?.status === "cancelled";
  };
  const onContainerStream = (executionId: string, chunk: ContainerStreamChunk) => {
    if (chunk.stdout) {
      void db.insert(runLogs).values({
        id: crypto.randomUUID(),
        executionId: executionId,
        level: "stdout",
        message: chunk.stdout,
        payload: null,
        createdAt: Date.now(),
      }).run();
    }
    if (chunk.stderr) {
      void db.insert(runLogs).values({
        id: crypto.randomUUID(),
        executionId,
        level: "stderr",
        message: chunk.stderr,
        payload: null,
        createdAt: Date.now(),
      }).run();
    }
    if (chunk.meta) {
      void db.insert(runLogs).values({
        id: crypto.randomUUID(),
        executionId,
        level: "meta",
        message: chunk.meta,
        payload: null,
        createdAt: Date.now(),
      }).run();
    }
  };

  try {
    const { output, context, trail } = await runWorkflow({
      workflowId,
      runId,
      branchId,
      resumeUserResponse: opts?.resumeUserResponse,
      onStepComplete,
      onProgress,
      isCancelled,
      onContainerStream,
      maxSelfFixRetries: getWorkflowMaxSelfFixRetries(),
    });
    await destroyContainerSession(runId);
    const payload = executionOutputSuccess(output ?? context, trail);
    await db.update(executions).set({
      status: "completed",
      finishedAt: Date.now(),
      output: JSON.stringify(payload),
    }).where(eq(executions.id, runId)).run();
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (rawMessage === WAITING_FOR_USER_MESSAGE) {
      return;
    }
    await destroyContainerSession(runId);
    if (rawMessage === RUN_CANCELLED_MESSAGE) {
      await db.update(executions).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(executions.id, runId)).run();
    } else {
      const message = withContainerInstallHint(rawMessage);
      const payload = executionOutputFailure(message, { message, stack: err instanceof Error ? err.stack : undefined });
      await db.update(executions).set({
        status: "failed",
        finishedAt: Date.now(),
        output: JSON.stringify(payload),
      }).where(eq(executions.id, runId)).run();
    }
  }
}
