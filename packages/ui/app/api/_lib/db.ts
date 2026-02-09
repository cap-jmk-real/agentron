import path from "node:path";
import fs from "node:fs";
import { createSqliteAdapter } from "@agentron-studio/core";
import {
  agents,
  workflows,
  llmConfigs,
  tools,
  executions,
  contexts,
  tokenUsage,
  tasks,
  chatMessages,
  files,
  sandboxes,
  customFunctions,
  feedback,
  modelPricing,
  remoteServers,
} from "@agentron-studio/core";
import type {
  Agent,
  Workflow,
  LLMConfig,
  ToolDefinition,
  ChatMessage,
  Feedback,
  FileEntry,
  Sandbox,
  CustomFunction,
} from "@agentron-studio/core";

const ensureDataDir = () => {
  const dataDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
};

const dbPath = path.join(ensureDataDir(), "agentron.sqlite");
const adapter = createSqliteAdapter(dbPath);
adapter.initialize?.();

export const db = adapter.db;
export { agents, workflows, llmConfigs, tools, executions, tokenUsage, tasks };

const parseJson = <T>(value?: string | null, fallback?: T): T | undefined => {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const toAgentRow = (agent: Agent) => ({
  id: agent.id,
  name: agent.name,
  description: agent.description ?? null,
  kind: agent.kind,
  type: agent.type,
  protocol: agent.protocol,
  endpoint: agent.endpoint ?? null,
  agentKey: agent.agentKey ?? null,
  capabilities: JSON.stringify(agent.capabilities ?? []),
  scopes: JSON.stringify(agent.scopes ?? []),
  llmConfig: agent.llmConfig ? JSON.stringify(agent.llmConfig) : null,
  definition: null,
  createdAt: Date.now()
});

export const fromAgentRow = (row: typeof agents.$inferSelect): Agent => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  kind: row.kind as Agent["kind"],
  type: row.type as Agent["type"],
  protocol: row.protocol as Agent["protocol"],
  endpoint: row.endpoint ?? undefined,
  agentKey: row.agentKey ?? undefined,
  capabilities: parseJson<string[]>(row.capabilities, []) ?? [],
  scopes: parseJson(row.scopes, []) ?? [],
  llmConfig: parseJson<LLMConfig>(row.llmConfig) ?? undefined
});

export const toWorkflowRow = (workflow: Workflow) => ({
  id: workflow.id,
  name: workflow.name,
  description: workflow.description ?? null,
  nodes: JSON.stringify(workflow.nodes ?? []),
  edges: JSON.stringify(workflow.edges ?? []),
  executionMode: workflow.executionMode,
  schedule: workflow.schedule ?? null,
  createdAt: Date.now()
});

export const fromWorkflowRow = (row: typeof workflows.$inferSelect): Workflow => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  nodes: parseJson(row.nodes, []) ?? [],
  edges: parseJson(row.edges, []) ?? [],
  executionMode: row.executionMode as Workflow["executionMode"],
  schedule: row.schedule ?? undefined
});

export const toToolRow = (tool: ToolDefinition) => ({
  id: tool.id,
  name: tool.name,
  protocol: tool.protocol,
  config: JSON.stringify(tool.config ?? {}),
  inputSchema: tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
  outputSchema: tool.outputSchema ? JSON.stringify(tool.outputSchema) : null
});

export const fromToolRow = (row: typeof tools.$inferSelect): ToolDefinition => ({
  id: row.id,
  name: row.name,
  protocol: row.protocol as ToolDefinition["protocol"],
  config: parseJson(row.config, {}) ?? {},
  inputSchema: parseJson(row.inputSchema),
  outputSchema: parseJson(row.outputSchema)
});

export const toLlmConfigRow = (config: LLMConfig & { id: string }) => ({
  id: config.id,
  provider: config.provider,
  model: config.model,
  apiKeyRef: config.apiKeyRef ?? null,
  endpoint: config.endpoint ?? null,
  extra: config.extra ? JSON.stringify(config.extra) : null
});

export const fromLlmConfigRow = (
  row: typeof llmConfigs.$inferSelect
): (LLMConfig & { id: string }) => ({
  id: row.id,
  provider: row.provider as LLMConfig["provider"],
  model: row.model,
  apiKeyRef: row.apiKeyRef ?? undefined,
  endpoint: row.endpoint ?? undefined,
  extra: parseJson(row.extra) ?? undefined
});

export const toExecutionRow = (entry: {
  id: string;
  targetType: string;
  targetId: string;
  status: string;
  output?: unknown;
}) => ({
  id: entry.id,
  targetType: entry.targetType,
  targetId: entry.targetId,
  status: entry.status,
  startedAt: Date.now(),
  finishedAt: null,
  output: entry.output ? JSON.stringify(entry.output) : null
});

export const fromExecutionRow = (row: typeof executions.$inferSelect) => ({
  id: row.id,
  targetType: row.targetType,
  targetId: row.targetId,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  output: parseJson(row.output)
});

export type TaskRow = {
  id: string;
  workflowId: string;
  executionId?: string | null;
  agentId: string;
  stepId: string;
  stepName: string;
  label?: string | null;
  status: string;
  input?: string | null;
  output?: string | null;
  createdAt: number;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
};

export const toTaskRow = (task: TaskRow) => ({
  id: task.id,
  workflowId: task.workflowId,
  executionId: task.executionId ?? null,
  agentId: task.agentId,
  stepId: task.stepId,
  stepName: task.stepName,
  label: task.label ?? null,
  status: task.status,
  input: task.input ?? null,
  output: task.output ?? null,
  createdAt: task.createdAt,
  resolvedAt: task.resolvedAt ?? null,
  resolvedBy: task.resolvedBy ?? null
});

export const fromTaskRow = (row: typeof tasks.$inferSelect): TaskRow => ({
  id: row.id,
  workflowId: row.workflowId,
  executionId: row.executionId ?? null,
  agentId: row.agentId,
  stepId: row.stepId,
  stepName: row.stepName,
  label: row.label ?? null,
  status: row.status,
  input: row.input ?? null,
  output: row.output ?? null,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt ?? null,
  resolvedBy: row.resolvedBy ?? null
});

const STANDARD_TOOLS: { id: string; name: string }[] = [
  { id: "std-fetch-url", name: "Fetch URL" },
  { id: "std-browser", name: "Browser" },
  { id: "std-run-code", name: "Run Code" },
  { id: "std-http-request", name: "HTTP Request" },
  { id: "std-webhook", name: "Webhook" },
  { id: "std-weather", name: "Weather" },
];

/** Ensures default/built-in tools exist in the DB so they appear in the Tools list. */
export async function ensureStandardTools(): Promise<void> {
  const existing = await db.select({ id: tools.id }).from(tools);
  const existingIds = new Set(existing.map((r) => r.id));
  for (const t of STANDARD_TOOLS) {
    if (existingIds.has(t.id)) continue;
    await db
      .insert(tools)
      .values({
        id: t.id,
        name: t.name,
        protocol: "native",
        config: "{}",
        inputSchema: null,
        outputSchema: null,
      })
      .run();
    existingIds.add(t.id);
  }
}
