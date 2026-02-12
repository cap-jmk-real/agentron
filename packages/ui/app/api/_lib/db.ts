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
  conversations,
  chatMessages,
  chatAssistantSettings,
  assistantMemory,
  files,
  sandboxes,
  sandboxSiteBindings,
  customFunctions,
  feedback,
  modelPricing,
  remoteServers,
  improvementJobs,
  techniqueInsights,
  techniquePlaybook,
  guardrails,
  agentStoreEntries,
  trainingRuns,
} from "@agentron-studio/core";
import type {
  Agent,
  Workflow,
  LLMConfig,
  ToolDefinition,
  ChatMessage,
  Conversation,
  ChatAssistantSettings,
  AssistantMemoryEntry,
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

export async function runBackup(targetPath: string): Promise<void> {
  if (!adapter.backupToPath) throw new Error("Adapter does not support backup");
  await adapter.backupToPath(targetPath);
}

export async function runRestore(sourcePath: string): Promise<void> {
  if (!adapter.restoreFromPath) throw new Error("Adapter does not support restore");
  await adapter.restoreFromPath(sourcePath);
}

export function runReset(): void {
  if (!adapter.resetDatabase) throw new Error("Adapter does not support reset");
  adapter.resetDatabase();
}
export {
  agents,
  workflows,
  llmConfigs,
  tools,
  executions,
  tokenUsage,
  tasks,
  conversations,
  chatMessages,
  chatAssistantSettings,
  assistantMemory,
  files,
  sandboxes,
  sandboxSiteBindings,
  customFunctions,
  feedback,
  modelPricing,
  remoteServers,
  improvementJobs,
  techniqueInsights,
  techniquePlaybook,
  guardrails,
  agentStoreEntries,
  trainingRuns,
};

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

export const toAgentRow = (agent: Agent) => {
  const def = (agent as Agent & { definition?: unknown }).definition;
  return {
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
    definition: def != null ? JSON.stringify(def) : null,
    createdAt: Date.now()
  };
};

export const fromAgentRow = (row: typeof agents.$inferSelect): Agent => {
  const agent: Agent & { definition?: unknown } = {
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
  };
  const def = parseJson<unknown>(row.definition);
  if (def != null && typeof def === "object") agent.definition = def;
  return agent;
};

export const toWorkflowRow = (workflow: Workflow) => ({
  id: workflow.id,
  name: workflow.name,
  description: workflow.description ?? null,
  nodes: JSON.stringify(workflow.nodes ?? []),
  edges: JSON.stringify(workflow.edges ?? []),
  executionMode: workflow.executionMode,
  schedule: workflow.schedule ?? null,
  maxRounds: (workflow as Workflow & { maxRounds?: number | null }).maxRounds ?? null,
  turnInstruction: (workflow as Workflow & { turnInstruction?: string | null }).turnInstruction ?? null,
  createdAt: Date.now()
});

export const fromWorkflowRow = (row: typeof workflows.$inferSelect): Workflow => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  nodes: parseJson(row.nodes, []) ?? [],
  edges: parseJson(row.edges, []) ?? [],
  executionMode: row.executionMode as Workflow["executionMode"],
  schedule: row.schedule ?? undefined,
  maxRounds: row.maxRounds ?? undefined,
  turnInstruction: row.turnInstruction ?? undefined
} as Workflow);

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

/** Payload for execution output on success (workflow/agent run). */
function executionOutputSuccess(
  output: unknown,
  trail?: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>
): { output: unknown; trail?: typeof trail } {
  return { output, ...(trail != null && trail.length > 0 ? { trail } : {}) };
}

/** Payload for execution output on failure (workflow/agent run). */
function executionOutputFailure(
  message: string,
  errorDetails?: Record<string, unknown>
): { success: false; error: string; errorDetails?: Record<string, unknown> } {
  return { success: false, error: message, ...(errorDetails ? { errorDetails } : {}) };
}

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

export const toConversationRow = (c: Conversation) => ({
  id: c.id,
  title: c.title ?? null,
  rating: c.rating ?? null,
  note: c.note ?? null,
  summary: c.summary ?? null,
  lastUsedProvider: c.lastUsedProvider ?? null,
  lastUsedModel: c.lastUsedModel ?? null,
  createdAt: c.createdAt
});

export const fromConversationRow = (row: typeof conversations.$inferSelect): Conversation => ({
  id: row.id,
  title: row.title ?? null,
  rating: row.rating ?? null,
  note: row.note ?? null,
  summary: row.summary ?? null,
  lastUsedProvider: (row as { lastUsedProvider?: string | null }).lastUsedProvider ?? null,
  lastUsedModel: (row as { lastUsedModel?: string | null }).lastUsedModel ?? null,
  createdAt: row.createdAt
});

export const toChatMessageRow = (m: ChatMessage) => ({
  id: m.id,
  conversationId: m.conversationId ?? null,
  role: m.role,
  content: m.content,
  toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
  llmTrace: m.llmTrace ? JSON.stringify(m.llmTrace) : null,
  createdAt: m.createdAt
});

export const fromChatMessageRow = (row: typeof chatMessages.$inferSelect): ChatMessage => {
  const r = row as typeof row & { llmTrace?: string | null };
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    toolCalls: parseJson(row.toolCalls),
    llmTrace: parseJson(r.llmTrace),
    createdAt: row.createdAt,
    conversationId: row.conversationId ?? undefined
  };
};

export const toChatAssistantSettingsRow = (s: ChatAssistantSettings) => ({
  id: s.id,
  customSystemPrompt: s.customSystemPrompt ?? null,
  contextAgentIds: s.contextAgentIds ? JSON.stringify(s.contextAgentIds) : null,
  contextWorkflowIds: s.contextWorkflowIds ? JSON.stringify(s.contextWorkflowIds) : null,
  contextToolIds: s.contextToolIds ? JSON.stringify(s.contextToolIds) : null,
  recentSummariesCount: s.recentSummariesCount ?? null,
  temperature: s.temperature != null ? String(s.temperature) : null,
  historyCompressAfter: s.historyCompressAfter ?? null,
  historyKeepRecent: s.historyKeepRecent ?? null,
  updatedAt: s.updatedAt
});

export const fromChatAssistantSettingsRow = (row: typeof chatAssistantSettings.$inferSelect): ChatAssistantSettings => ({
  id: row.id,
  customSystemPrompt: row.customSystemPrompt ?? null,
  contextAgentIds: parseJson<string[]>(row.contextAgentIds) ?? null,
  contextWorkflowIds: parseJson<string[]>(row.contextWorkflowIds) ?? null,
  contextToolIds: parseJson<string[]>(row.contextToolIds) ?? null,
  recentSummariesCount: row.recentSummariesCount ?? null,
  temperature: row.temperature != null ? Number(row.temperature) : null,
  historyCompressAfter: row.historyCompressAfter ?? null,
  historyKeepRecent: row.historyKeepRecent ?? null,
  updatedAt: row.updatedAt
});

export const toAssistantMemoryRow = (e: AssistantMemoryEntry) => ({
  id: e.id,
  key: e.key ?? null,
  content: e.content,
  createdAt: e.createdAt
});

export const fromAssistantMemoryRow = (row: typeof assistantMemory.$inferSelect): AssistantMemoryEntry => ({
  id: row.id,
  key: row.key ?? null,
  content: row.content,
  createdAt: row.createdAt
});

export const fromLlmConfigRowWithSecret = (
  row: typeof llmConfigs.$inferSelect
): (LLMConfig & { id: string }) => fromLlmConfigRow(row);

export const toSandboxRow = (s: Sandbox) => ({
  id: s.id,
  name: s.name,
  image: s.image,
  status: s.status,
  containerId: s.containerId ?? null,
  config: JSON.stringify(s.config ?? {}),
  createdAt: s.createdAt
});

export const fromSandboxRow = (row: typeof sandboxes.$inferSelect): Sandbox => ({
  id: row.id,
  name: row.name,
  image: row.image,
  status: row.status as Sandbox["status"],
  containerId: row.containerId ?? undefined,
  config: parseJson(row.config, {}) ?? {},
  createdAt: row.createdAt
});

export type SandboxSiteBinding = {
  id: string;
  sandboxId: string;
  host: string;
  containerPort: number;
  hostPort: number;
  createdAt: number;
};

export const toSandboxSiteBindingRow = (b: SandboxSiteBinding) => ({
  id: b.id,
  sandboxId: b.sandboxId,
  host: b.host,
  containerPort: b.containerPort,
  hostPort: b.hostPort,
  createdAt: b.createdAt
});

export const fromSandboxSiteBindingRow = (row: typeof sandboxSiteBindings.$inferSelect): SandboxSiteBinding => ({
  id: row.id,
  sandboxId: row.sandboxId,
  host: row.host,
  containerPort: row.containerPort,
  hostPort: row.hostPort,
  createdAt: row.createdAt
});

export const toFileRow = (f: FileEntry) => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  size: f.size,
  path: f.path,
  createdAt: f.createdAt
});

export const fromFileRow = (row: typeof files.$inferSelect): FileEntry => ({
  id: row.id,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
  path: row.path,
  createdAt: row.createdAt
});

export const toFeedbackRow = (f: Feedback) => ({
  id: f.id,
  targetType: f.targetType,
  targetId: f.targetId,
  executionId: f.executionId ?? null,
  input: JSON.stringify(f.input),
  output: JSON.stringify(f.output),
  label: f.label,
  notes: f.notes ?? null,
  createdAt: f.createdAt
});

export const fromFeedbackRow = (row: typeof feedback.$inferSelect): Feedback => ({
  id: row.id,
  targetType: row.targetType as Feedback["targetType"],
  targetId: row.targetId,
  executionId: row.executionId ?? undefined,
  input: parseJson(row.input),
  output: parseJson(row.output),
  label: row.label as Feedback["label"],
  notes: row.notes ?? undefined,
  createdAt: row.createdAt
});

export type ModelPricingRow = {
  id: string;
  modelPattern: string;
  inputCostPerM: string;
  outputCostPerM: string;
  updatedAt: number;
};

export const toModelPricingRow = (p: ModelPricingRow) => ({
  id: p.id,
  modelPattern: p.modelPattern,
  inputCostPerM: p.inputCostPerM,
  outputCostPerM: p.outputCostPerM,
  updatedAt: p.updatedAt
});

export const fromModelPricingRow = (row: typeof modelPricing.$inferSelect): ModelPricingRow => ({
  id: row.id,
  modelPattern: row.modelPattern,
  inputCostPerM: row.inputCostPerM,
  outputCostPerM: row.outputCostPerM,
  updatedAt: row.updatedAt
});

export const toTokenUsageRow = (u: {
  id: string;
  executionId?: string | null;
  agentId?: string | null;
  workflowId?: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCost?: string | null;
}) => ({
  id: u.id,
  executionId: u.executionId ?? null,
  agentId: u.agentId ?? null,
  workflowId: u.workflowId ?? null,
  provider: u.provider,
  model: u.model,
  promptTokens: u.promptTokens,
  completionTokens: u.completionTokens,
  estimatedCost: u.estimatedCost ?? null,
  createdAt: Date.now()
});

export type RemoteServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  authType: string;
  keyPath?: string | null;
  modelBaseUrl?: string | null;
  createdAt?: number;
};

export const toRemoteServerRow = (s: RemoteServer) => ({
  id: s.id,
  label: s.label,
  host: s.host,
  port: s.port,
  user: s.user,
  authType: s.authType,
  keyPath: s.keyPath ?? null,
  modelBaseUrl: s.modelBaseUrl ?? null,
  createdAt: s.createdAt ?? Date.now()
});

export const fromRemoteServerRow = (row: typeof remoteServers.$inferSelect): RemoteServer => ({
  id: row.id,
  label: row.label,
  host: row.host,
  port: row.port,
  user: row.user,
  authType: row.authType,
  keyPath: row.keyPath ?? undefined,
  modelBaseUrl: row.modelBaseUrl ?? undefined,
  createdAt: row.createdAt
});

export const toCustomFunctionRow = (f: CustomFunction) => ({
  id: f.id,
  name: f.name,
  description: f.description ?? null,
  language: f.language,
  source: f.source,
  sandboxId: f.sandboxId ?? null,
  createdAt: f.createdAt
});

export const fromCustomFunctionRow = (row: typeof customFunctions.$inferSelect): CustomFunction => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  language: row.language,
  source: row.source,
  sandboxId: row.sandboxId ?? undefined,
  createdAt: row.createdAt
});

const FILES_DIR = path.join(process.cwd(), ".data", "files");
export function ensureFilesDir(): string {
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
  return FILES_DIR;
}

export const STANDARD_TOOLS: { id: string; name: string }[] = [
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

export { executionOutputSuccess, executionOutputFailure };
