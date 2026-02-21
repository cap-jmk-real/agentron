/**
 * Studio tool execution and workflow memory block builder used by the workflow engine.
 * Extracted from run-workflow.ts to keep run-workflow under 1000 lines.
 */
import { eq } from "drizzle-orm";
import {
  fetchUrl,
  runCode,
  httpRequest,
  httpToolAdapter,
  webhook,
  weather,
  searchWeb,
} from "@agentron-studio/runtime";
import {
  db,
  tools as toolsTable,
  customFunctions,
  sandboxes,
  runLogs,
  ensureStandardTools,
  STANDARD_TOOLS,
} from "./db";
import { fromToolRow, fromCustomFunctionRow, fromSandboxRow } from "./db";
import { getContainerManager } from "./container-manager";
import { getStoredCredential, listStoredCredentialKeys } from "./credential-store";
import { getRunForImprovement } from "./run-for-improvement";
import { getFeedbackForScope } from "./feedback-for-scope";
import { runContainer, runContainerBuild } from "./run-workflow-containers";
import { getAppSettings } from "./app-settings";

/** std-web-search wrapper: reads app settings (provider + keys) and calls searchWeb. */
async function stdWebSearchWithSettings(input: unknown): Promise<unknown> {
  if (input === null || typeof input !== "object") {
    return { error: "Input must be an object with query", results: [] };
  }
  const o = input as Record<string, unknown>;
  const query = typeof o.query === "string" ? o.query.trim() : "";
  if (!query) {
    return { error: "query is required", results: [] };
  }
  const maxResults =
    typeof o.maxResults === "number" && o.maxResults > 0 ? Math.min(o.maxResults, 20) : undefined;
  const appSettings = getAppSettings();
  try {
    return await searchWeb(query, {
      maxResults,
      provider: appSettings.webSearchProvider,
      braveApiKey: appSettings.braveSearchApiKey,
      googleCseKey: appSettings.googleCseKey,
      googleCseCx: appSettings.googleCseCx,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Web search failed", message, results: [] };
  }
}

/** Standard tool IDs that map to runtime implementations. Exported for workflow engine buildToolInstructionsBlock. */
export const STD_IDS: Record<string, (input: unknown) => Promise<unknown>> = {
  "std-fetch-url": fetchUrl,
  "std-browser": fetchUrl,
  "std-run-code": runCode,
  "std-http-request": httpRequest,
  "std-webhook": webhook,
  "std-weather": weather,
  "std-web-search": stdWebSearchWithSettings,
  "std-container-run": runContainer,
  "std-container-build": runContainerBuild,
};

/** Execute a custom function (JavaScript/Python) in its sandbox. Used when a tool wraps a custom function. */
async function runCustomFunction(functionId: string, input: unknown): Promise<unknown> {
  const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, functionId));
  if (fnRows.length === 0) return { error: `Custom function not found: ${functionId}` };

  const fn = fromCustomFunctionRow(fnRows[0]);
  if (!fn.sandboxId)
    return {
      error: "No sandbox assigned to this function. Assign a sandbox in Tools or Functions.",
    };

  const sbRows = await db.select().from(sandboxes).where(eq(sandboxes.id, fn.sandboxId));
  if (sbRows.length === 0) return { error: "Sandbox not found for this function." };

  const sb = fromSandboxRow(sbRows[0]);
  const containerId = sb.containerId;
  if (!containerId || sb.status !== "running")
    return { error: "Sandbox is not running. Start the sandbox first." };

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
      return {
        error: result.stderr || "Function execution failed",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
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

export type ToolOverride = {
  config?: Record<string, unknown>;
  inputSchema?: unknown;
  name?: string;
};

export type LLMToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export async function buildAvailableTools(toolIds: string[]): Promise<LLMToolDef[]> {
  if (toolIds.length === 0) return [];
  const out: LLMToolDef[] = [];
  for (const id of toolIds) {
    if (id === "std-request-user-help") continue;
    if (id in STD_IDS) {
      const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
      const tool =
        rows.length > 0
          ? fromToolRow(rows[0])
          : (STANDARD_TOOLS.find((t) => t.id === id) ?? {
              id,
              name: id,
              protocol: "native" as const,
              config: {},
              inputSchema: { type: "object", properties: {}, required: [] },
            });
      const inputSchema =
        typeof (tool as unknown as { inputSchema?: unknown }).inputSchema === "object" &&
        (tool as unknown as { inputSchema?: unknown }).inputSchema !== null
          ? (tool as unknown as { inputSchema: Record<string, unknown> }).inputSchema
          : { type: "object", properties: {}, required: [] };
      const schema = inputSchema as Record<string, unknown>;
      const cfg = (tool as { config?: { description?: string } }).config;
      const description = typeof cfg?.description === "string" ? cfg.description : tool.name;
      out.push({
        type: "function",
        function: {
          name: tool.id,
          description,
          parameters: schema,
        },
      });
      continue;
    }
    const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
    if (rows.length === 0) continue;
    const tool = fromToolRow(rows[0]);
    const schema = (
      typeof tool.inputSchema === "object" && tool.inputSchema !== null
        ? tool.inputSchema
        : { type: "object", properties: {}, required: [] }
    ) as Record<string, unknown>;
    const cfg = (tool as { config?: { description?: string } }).config;
    const description = typeof cfg?.description === "string" ? cfg.description : tool.name;
    out.push({
      type: "function",
      function: {
        name: tool.id,
        description,
        parameters: schema,
      },
    });
  }
  return out;
}

export async function executeStudioTool(
  toolId: string,
  input: unknown,
  override?: ToolOverride,
  vaultKey?: Buffer | null,
  isCancelled?: () => Promise<boolean>,
  runId?: string
): Promise<unknown> {
  if (toolId === "get_run_for_improvement") {
    const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const runIdArg = typeof arg.runId === "string" ? arg.runId.trim() : "";
    if (!runIdArg) return { error: "runId is required" };
    const includeFullLogs = arg.includeFullLogs === true;
    return getRunForImprovement(runIdArg, { includeFullLogs });
  }
  if (toolId === "get_feedback_for_scope") {
    const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const targetId = typeof arg.targetId === "string" ? arg.targetId.trim() : "";
    if (!targetId) return { error: "targetId is required" };
    const label =
      typeof arg.label === "string" && arg.label.trim()
        ? (arg.label.trim() as "good" | "bad")
        : undefined;
    const limit = typeof arg.limit === "number" && arg.limit > 0 ? arg.limit : undefined;
    return getFeedbackForScope(targetId, { label, limit });
  }
  const improvementToolIds = new Set([
    "create_improvement_job",
    "get_improvement_job",
    "list_improvement_jobs",
    "update_improvement_job",
    "generate_training_data",
    "trigger_training",
    "get_training_status",
    "evaluate_model",
    "register_trained_model",
    "list_specialist_models",
    "decide_optimization_target",
    "get_technique_knowledge",
    "record_technique_insight",
    "propose_architecture",
    "spawn_instance",
  ]);
  if (improvementToolIds.has(toolId)) {
    const { executeTool } = await import("../chat/_lib/execute-tool");
    return executeTool(
      toolId,
      (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>,
      { conversationId: undefined, vaultKey: vaultKey ?? null }
    );
  }
  if (toolId === "std-list-vault-credentials") {
    if (!vaultKey)
      return {
        error:
          "Vault not approved for this run. Tell the user: To grant vault access, unlock the vault first (open Vault in the Studio and enter your master password), then reply again here (e.g. 'Proceed' or 'Approve vault'). The run will then have access to list and use credentials.",
      };
    const list = await listStoredCredentialKeys(vaultKey);
    return { keys: list.map((r) => r.key) };
  }
  if (toolId === "std-get-vault-credential") {
    const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const credentialKey = typeof arg.credentialKey === "string" ? arg.credentialKey.trim() : "";
    if (!credentialKey) return { error: "credentialKey is required" };
    if (!vaultKey) {
      return {
        error:
          "Vault not approved for this run. Tell the user: Unlock the vault first (open Vault in the Studio, enter your master password), then reply again to this run (e.g. 'Proceed' or 'Approve vault'). The run will then be able to read credentials.",
      };
    }
    const value = await getStoredCredential(credentialKey, vaultKey);
    if (value === null)
      return {
        error: `Credential not found for key: ${credentialKey}. Call std-list-vault-credentials to see which keys are stored in the vault, then use one of those exact key names.`,
      };
    return { value };
  }
  if (toolId === "std-browser-automation") {
    const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const action = typeof arg.action === "string" ? arg.action : "";
    const value = typeof arg.value === "string" ? arg.value : "";
    const looksLikePlaceholder =
      /^\s*\{\{/.test(value) ||
      /__VAULT_/i.test(value) ||
      (/\/\//.test(value) && value.toLowerCase().includes("vault"));
    if (action === "fill" && looksLikePlaceholder) {
      return {
        success: false,
        error:
          "You DO have access to the vault. Call std-list-vault-credentials to see stored key names, then std-get-vault-credential with the exact key for username and for password. Use each returned .value in fill. Do not ask the user to paste credentials or type placeholders.",
      };
    }
    const { browserAutomation } = await import("./browser-automation");
    const onLog =
      runId != null
        ? (entry: {
            level: "stdout" | "stderr";
            message: string;
            payload?: Record<string, unknown>;
          }) => {
            void db
              .insert(runLogs)
              .values({
                id: crypto.randomUUID(),
                executionId: runId,
                level: entry.level,
                message: entry.message,
                payload: entry.payload != null ? JSON.stringify(entry.payload) : null,
                createdAt: Date.now(),
              })
              .run();
          }
        : undefined;
    return browserAutomation(input ?? {}, { isCancelled, onLog });
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
      typeof input === "object" && input !== null && "url" in (input as object)
        ? (input as { url: string }).url
        : undefined;
    if (typeof fallbackUrl === "string")
      return httpRequest({
        ...(typeof input === "object" && input !== null ? (input as object) : {}),
        url: fallbackUrl,
      });
  }
  const baseToolId =
    (mergedConfig as { baseToolId?: string })?.baseToolId ??
    (tool.config as { baseToolId?: string })?.baseToolId ??
    tool.id;
  const std = STD_IDS[baseToolId];
  if (std) return std(input ?? {});

  let functionId: string | undefined =
    (mergedConfig as { functionId?: string })?.functionId ??
    (tool.config as { functionId?: string })?.functionId ??
    (toolId.startsWith("fn-") ? toolId.slice(3) : undefined);
  if (!functionId) {
    const fnRows = await db
      .select({ id: customFunctions.id })
      .from(customFunctions)
      .where(eq(customFunctions.id, toolId));
    if (fnRows.length > 0) functionId = toolId;
  }
  if (functionId) return runCustomFunction(functionId, input ?? {});

  return { error: `Tool ${toolId} not supported in workflow execution` };
}

/** Prefix for run_log message so logs clearly show where the error or event came from. */
export function getLogSourceTag(toolId: string): string {
  switch (toolId) {
    case "std-browser-automation":
      return "[Playwright]";
    case "std-run-code":
      return "[Run code]";
    case "std-container-run":
    case "std-container-session":
      return "[Container]";
    case "std-web-search":
      return "[Web search]";
    default:
      return "[Tool]";
  }
}

export const WORKFLOW_MEMORY_MAX_RECENT_TURNS = 12;
export const GET_WORKFLOW_CONTEXT_TOOL_ID = "get_workflow_context";
export const FIRST_TURN_DEFAULT = "(First turn — start the conversation.)";

export function buildWorkflowMemoryBlock(opts: {
  turnInstruction?: string | null;
  summary: string;
  recentTurns: Array<{ speaker: string; text: string }>;
  partnerMessage: string;
  precedingAgentName?: string | null;
  maxRecentTurns?: number;
}): string {
  const {
    turnInstruction,
    summary,
    recentTurns,
    partnerMessage,
    precedingAgentName,
    maxRecentTurns = WORKFLOW_MEMORY_MAX_RECENT_TURNS,
  } = opts;
  const hasContext =
    (turnInstruction && String(turnInstruction).trim()) || summary.trim() || recentTurns.length > 0;
  const isFirstTurnNoContext =
    !hasContext && (partnerMessage === FIRST_TURN_DEFAULT || partnerMessage.trim() === "");

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
  const incomingLabel =
    precedingAgentName && String(precedingAgentName).trim()
      ? `Output from ${String(precedingAgentName).trim()}:\n`
      : "";
  parts.push(incomingLabel + partnerMessage);
  return parts.join("\n\n");
}
