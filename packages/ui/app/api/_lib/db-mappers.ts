/**
 * Row mappers (toXRow / fromXRow) and related types for DB tables.
 * Import table refs from core for $inferSelect types; db.ts re-exports these.
 */
import {
  agents,
  workflows,
  llmConfigs,
  tools,
  executions,
  tasks,
  conversations,
  chatMessages,
  chatAssistantSettings,
  assistantMemory,
  sandboxes,
  sandboxSiteBindings,
  files,
  feedback,
  modelPricing,
  remoteServers,
  customFunctions,
  reminders,
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

export const parseJson = <T>(value?: string | null, fallback?: T): T | undefined => {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export type ReminderTaskType = "message" | "assistant_task";

export type Reminder = {
  id: string;
  runAt: number;
  message: string;
  conversationId?: string | null;
  taskType: ReminderTaskType;
  status: "pending" | "fired" | "cancelled";
  createdAt: number;
  firedAt?: number | null;
};

export const toReminderRow = (r: Reminder) => ({
  id: r.id,
  runAt: r.runAt,
  message: r.message,
  conversationId: r.conversationId ?? null,
  taskType: r.taskType,
  status: r.status,
  createdAt: r.createdAt,
  firedAt: r.firedAt ?? null,
});

export const fromReminderRow = (row: typeof reminders.$inferSelect): Reminder => ({
  id: row.id,
  runAt: row.runAt,
  message: row.message,
  conversationId: row.conversationId ?? undefined,
  taskType: (row.taskType ?? "message") as Reminder["taskType"],
  status: row.status as Reminder["status"],
  createdAt: row.createdAt,
  firedAt: row.firedAt ?? undefined,
});

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
    createdAt: Date.now(),
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
    llmConfig: parseJson<LLMConfig>(row.llmConfig) ?? undefined,
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
  turnInstruction:
    (workflow as Workflow & { turnInstruction?: string | null }).turnInstruction ?? null,
  branches: workflow.branches != null ? JSON.stringify(workflow.branches) : null,
  executionOrder:
    workflow.executionOrder != null && workflow.executionOrder.length > 0
      ? JSON.stringify(workflow.executionOrder)
      : null,
  createdAt: Date.now(),
});

export const fromWorkflowRow = (row: typeof workflows.$inferSelect): Workflow =>
  ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodes: parseJson(row.nodes, []) ?? [],
    edges: parseJson(row.edges, []) ?? [],
    executionMode: row.executionMode as Workflow["executionMode"],
    schedule: row.schedule ?? undefined,
    maxRounds: row.maxRounds ?? undefined,
    turnInstruction: row.turnInstruction ?? undefined,
    branches: parseJson((row as { branches?: string | null }).branches) ?? undefined,
    executionOrder:
      parseJson((row as { executionOrder?: string | null }).executionOrder) ?? undefined,
  }) as Workflow;

export const toToolRow = (tool: ToolDefinition) => ({
  id: tool.id,
  name: tool.name,
  protocol: tool.protocol,
  config: JSON.stringify(tool.config ?? {}),
  inputSchema: tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
  outputSchema: tool.outputSchema ? JSON.stringify(tool.outputSchema) : null,
});

export const fromToolRow = (row: typeof tools.$inferSelect): ToolDefinition => ({
  id: row.id,
  name: row.name,
  protocol: row.protocol as ToolDefinition["protocol"],
  config: parseJson(row.config, {}) ?? {},
  inputSchema: parseJson(row.inputSchema),
  outputSchema: parseJson(row.outputSchema),
});

export const toLlmConfigRow = (config: LLMConfig & { id: string }) => ({
  id: config.id,
  provider: config.provider,
  model: config.model,
  apiKeyRef: config.apiKeyRef ?? null,
  endpoint: config.endpoint ?? null,
  extra: config.extra ? JSON.stringify(config.extra) : null,
});

export const fromLlmConfigRow = (
  row: typeof llmConfigs.$inferSelect
): LLMConfig & { id: string } => ({
  id: row.id,
  provider: row.provider as LLMConfig["provider"],
  model: row.model,
  apiKeyRef: row.apiKeyRef ?? undefined,
  endpoint: row.endpoint ?? undefined,
  extra: parseJson(row.extra) ?? undefined,
});

export const toExecutionRow = (entry: {
  id: string;
  targetType: string;
  targetId: string;
  targetBranchId?: string | null;
  conversationId?: string | null;
  status: string;
  output?: unknown;
}) => ({
  id: entry.id,
  targetType: entry.targetType,
  targetId: entry.targetId,
  targetBranchId: entry.targetBranchId ?? null,
  conversationId: entry.conversationId ?? null,
  status: entry.status,
  startedAt: Date.now(),
  finishedAt: null,
  output: entry.output ? JSON.stringify(entry.output) : null,
});

export const fromExecutionRow = (row: typeof executions.$inferSelect) => ({
  id: row.id,
  targetType: row.targetType,
  targetId: row.targetId,
  targetBranchId: (row as { targetBranchId?: string | null }).targetBranchId ?? undefined,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  output: parseJson(row.output),
});

export type WorkflowMessageRow = {
  id: string;
  executionId: string;
  nodeId?: string | null;
  agentId?: string | null;
  role: "agent" | "user" | "system";
  content: string;
  messageType?: string | null;
  metadata?: string | null;
  createdAt: number;
};

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
  resolvedBy: task.resolvedBy ?? null,
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
  resolvedBy: row.resolvedBy ?? null,
});

export const toConversationRow = (c: Conversation) => ({
  id: c.id,
  title: c.title ?? null,
  rating: c.rating ?? null,
  note: c.note ?? null,
  summary: c.summary ?? null,
  lastUsedProvider: c.lastUsedProvider ?? null,
  lastUsedModel: c.lastUsedModel ?? null,
  createdAt: c.createdAt,
});

export const fromConversationRow = (row: typeof conversations.$inferSelect): Conversation => ({
  id: row.id,
  title: row.title ?? null,
  rating: row.rating ?? null,
  note: row.note ?? null,
  summary: row.summary ?? null,
  lastUsedProvider: (row as { lastUsedProvider?: string | null }).lastUsedProvider ?? null,
  lastUsedModel: (row as { lastUsedModel?: string | null }).lastUsedModel ?? null,
  createdAt: row.createdAt,
});

export const toChatMessageRow = (m: ChatMessage) => ({
  id: m.id,
  conversationId: m.conversationId ?? null,
  role: m.role,
  content: m.content,
  toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
  llmTrace: m.llmTrace ? JSON.stringify(m.llmTrace) : null,
  rephrasedPrompt: m.rephrasedPrompt ?? null,
  createdAt: m.createdAt,
});

function normalizeToolCalls(raw: unknown): ChatMessage["toolCalls"] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const normalized = raw
    .map((item: unknown) => {
      const t = item as {
        name?: string;
        args?: Record<string, unknown>;
        arguments?: Record<string, unknown>;
        result?: unknown;
      };
      const name = typeof t.name === "string" ? t.name : "";
      const args = t.args ?? t.arguments ?? {};
      const result = t.result;
      return {
        id:
          typeof (t as { id?: string }).id === "string"
            ? (t as { id: string }).id
            : crypto.randomUUID(),
        name,
        arguments: typeof args === "object" && args !== null ? args : {},
        result,
      };
    })
    .filter((t) => t.name);
  return normalized.length > 0 ? normalized : undefined;
}

export const fromChatMessageRow = (row: typeof chatMessages.$inferSelect): ChatMessage => {
  const r = row as typeof row & { llmTrace?: string | null; rephrasedPrompt?: string | null };
  const parsed = parseJson<unknown[]>(row.toolCalls);
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    toolCalls: parsed ? normalizeToolCalls(parsed) : undefined,
    llmTrace: parseJson(r.llmTrace),
    rephrasedPrompt:
      typeof r.rephrasedPrompt === "string" && r.rephrasedPrompt.trim()
        ? r.rephrasedPrompt
        : undefined,
    createdAt: row.createdAt,
    conversationId: row.conversationId ?? undefined,
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
  plannerRecentMessages: s.plannerRecentMessages ?? null,
  ragRetrieveLimit: s.ragRetrieveLimit ?? null,
  feedbackLastN: s.feedbackLastN ?? null,
  feedbackRetrieveCap: s.feedbackRetrieveCap ?? null,
  feedbackMinScore: s.feedbackMinScore != null ? String(s.feedbackMinScore) : null,
  updatedAt: s.updatedAt,
});

export const fromChatAssistantSettingsRow = (
  row: typeof chatAssistantSettings.$inferSelect
): ChatAssistantSettings => ({
  id: row.id,
  customSystemPrompt: row.customSystemPrompt ?? null,
  contextAgentIds: parseJson<string[]>(row.contextAgentIds) ?? null,
  contextWorkflowIds: parseJson<string[]>(row.contextWorkflowIds) ?? null,
  contextToolIds: parseJson<string[]>(row.contextToolIds) ?? null,
  recentSummariesCount: row.recentSummariesCount ?? null,
  temperature: row.temperature != null ? Number(row.temperature) : null,
  historyCompressAfter: row.historyCompressAfter ?? null,
  historyKeepRecent: row.historyKeepRecent ?? null,
  plannerRecentMessages: row.plannerRecentMessages ?? null,
  ragRetrieveLimit: row.ragRetrieveLimit ?? null,
  feedbackLastN: row.feedbackLastN ?? null,
  feedbackRetrieveCap: row.feedbackRetrieveCap ?? null,
  feedbackMinScore: row.feedbackMinScore != null ? Number(row.feedbackMinScore) : null,
  updatedAt: row.updatedAt,
});

export const toAssistantMemoryRow = (e: AssistantMemoryEntry) => ({
  id: e.id,
  key: e.key ?? null,
  content: e.content,
  createdAt: e.createdAt,
});

export const fromAssistantMemoryRow = (
  row: typeof assistantMemory.$inferSelect
): AssistantMemoryEntry => ({
  id: row.id,
  key: row.key ?? null,
  content: row.content,
  createdAt: row.createdAt,
});

export const fromLlmConfigRowWithSecret = (
  row: typeof llmConfigs.$inferSelect
): LLMConfig & { id: string } => fromLlmConfigRow(row);

export const toSandboxRow = (s: Sandbox) => ({
  id: s.id,
  name: s.name,
  image: s.image,
  status: s.status,
  containerId: s.containerId ?? null,
  config: JSON.stringify(s.config ?? {}),
  createdAt: s.createdAt,
});

export const fromSandboxRow = (row: typeof sandboxes.$inferSelect): Sandbox => ({
  id: row.id,
  name: row.name,
  image: row.image,
  status: row.status as Sandbox["status"],
  containerId: row.containerId ?? undefined,
  config: parseJson(row.config, {}) ?? {},
  createdAt: row.createdAt,
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
  createdAt: b.createdAt,
});

export const fromSandboxSiteBindingRow = (
  row: typeof sandboxSiteBindings.$inferSelect
): SandboxSiteBinding => ({
  id: row.id,
  sandboxId: row.sandboxId,
  host: row.host,
  containerPort: row.containerPort,
  hostPort: row.hostPort,
  createdAt: row.createdAt,
});

export const toFileRow = (f: FileEntry) => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  size: f.size,
  path: f.path,
  createdAt: f.createdAt,
});

export const fromFileRow = (row: typeof files.$inferSelect): FileEntry => ({
  id: row.id,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
  path: row.path,
  createdAt: row.createdAt,
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
  createdAt: f.createdAt,
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
  createdAt: row.createdAt,
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
  updatedAt: p.updatedAt,
});

export const fromModelPricingRow = (row: typeof modelPricing.$inferSelect): ModelPricingRow => ({
  id: row.id,
  modelPattern: row.modelPattern,
  inputCostPerM: row.inputCostPerM,
  outputCostPerM: row.outputCostPerM,
  updatedAt: row.updatedAt,
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
  createdAt: Date.now(),
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
  createdAt: s.createdAt ?? Date.now(),
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
  createdAt: row.createdAt,
});

export const toCustomFunctionRow = (f: CustomFunction) => ({
  id: f.id,
  name: f.name,
  description: f.description ?? null,
  language: f.language,
  source: f.source,
  sandboxId: f.sandboxId ?? null,
  createdAt: f.createdAt,
});

export const fromCustomFunctionRow = (
  row: typeof customFunctions.$inferSelect
): CustomFunction => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  language: row.language,
  source: row.source,
  sandboxId: row.sandboxId ?? undefined,
  createdAt: row.createdAt,
});
