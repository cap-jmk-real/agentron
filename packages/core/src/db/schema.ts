import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind").notNull(),
  type: text("type").notNull(),
  protocol: text("protocol").notNull(),
  endpoint: text("endpoint"),
  agentKey: text("agent_key"),
  capabilities: text("capabilities").notNull(),
  scopes: text("scopes").notNull(),
  llmConfig: text("llm_config"),
  definition: text("definition"),
  createdAt: integer("created_at").notNull()
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  nodes: text("nodes").notNull(),
  edges: text("edges").notNull(),
  executionMode: text("execution_mode").notNull(),
  schedule: text("schedule"),
  maxRounds: integer("max_rounds"),
  turnInstruction: text("turn_instruction"),
  branches: text("branches"),
  createdAt: integer("created_at").notNull()
});

export const tools = sqliteTable("tools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  config: text("config").notNull(),
  inputSchema: text("input_schema"),
  outputSchema: text("output_schema")
});

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  arguments: text("arguments"),
  template: text("template").notNull()
});

export const llmConfigs = sqliteTable("llm_configs", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiKeyRef: text("api_key_ref"),
  endpoint: text("endpoint"),
  extra: text("extra")
});

export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  targetBranchId: text("target_branch_id"),
  conversationId: text("conversation_id"),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  output: text("output")
});

export const contexts = sqliteTable("contexts", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull()
});

// --- New tables ---

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  rating: integer("rating"),
  note: text("note"),
  summary: text("summary"),
  lastUsedProvider: text("last_used_provider"),
  lastUsedModel: text("last_used_model"),
  createdAt: integer("created_at").notNull()
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"),
  llmTrace: text("llm_trace"),
  rephrasedPrompt: text("rephrased_prompt"),
  createdAt: integer("created_at").notNull()
});

export const chatAssistantSettings = sqliteTable("chat_assistant_settings", {
  id: text("id").primaryKey(),
  customSystemPrompt: text("custom_system_prompt"),
  contextAgentIds: text("context_agent_ids"),
  contextWorkflowIds: text("context_workflow_ids"),
  contextToolIds: text("context_tool_ids"),
  recentSummariesCount: integer("recent_summaries_count"),
  temperature: text("temperature"),
  historyCompressAfter: integer("history_compress_after"),
  historyKeepRecent: integer("history_keep_recent"),
  updatedAt: integer("updated_at").notNull()
});

export const assistantMemory = sqliteTable("assistant_memory", {
  id: text("id").primaryKey(),
  key: text("key"),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull()
});

/** User-saved credentials (e.g. API keys) keyed by credentialKey from ask_credentials. Encrypted with vault master password; never echoed in chat. */
export const savedCredentials = sqliteTable("saved_credentials", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at").notNull()
});

/** Single row: vault salt and encrypted check value. Used to verify master password; credentials are encrypted with key derived from master password. */
export const vaultMeta = sqliteTable("vault_meta", {
  id: text("id").primaryKey(),
  salt: text("salt").notNull(),
  check: text("check").notNull(),
  createdAt: integer("created_at").notNull()
});

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull()
});

export const sandboxes = sqliteTable("sandboxes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  image: text("image").notNull(),
  status: text("status").notNull(),
  containerId: text("container_id"),
  config: text("config").notNull(),
  createdAt: integer("created_at").notNull()
});

export const sandboxSiteBindings = sqliteTable("sandbox_site_bindings", {
  id: text("id").primaryKey(),
  sandboxId: text("sandbox_id").notNull(),
  host: text("host").notNull(),
  containerPort: integer("container_port").notNull(),
  hostPort: integer("host_port").notNull(),
  createdAt: integer("created_at").notNull()
});

export const customFunctions = sqliteTable("custom_functions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  language: text("language").notNull(),
  source: text("source").notNull(),
  sandboxId: text("sandbox_id"),
  createdAt: integer("created_at").notNull()
});

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  executionId: text("execution_id"),
  input: text("input").notNull(),
  output: text("output").notNull(),
  label: text("label").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at").notNull()
});

export const tokenUsage = sqliteTable("token_usage", {
  id: text("id").primaryKey(),
  executionId: text("execution_id"),
  agentId: text("agent_id"),
  workflowId: text("workflow_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  estimatedCost: text("estimated_cost"),
  createdAt: integer("created_at").notNull()
});

export const modelPricing = sqliteTable("model_pricing", {
  id: text("id").primaryKey(),
  modelPattern: text("model_pattern").notNull(),
  inputCostPerM: text("input_cost_per_m").notNull(),
  outputCostPerM: text("output_cost_per_m").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const remoteServers = sqliteTable("remote_servers", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  user: text("user").notNull(),
  authType: text("auth_type").notNull(),
  keyPath: text("key_path"),
  modelBaseUrl: text("model_base_url"),
  createdAt: integer("created_at").notNull()
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull(),
  executionId: text("execution_id"),
  agentId: text("agent_id").notNull(),
  stepId: text("step_id").notNull(),
  stepName: text("step_name").notNull(),
  label: text("label"),
  status: text("status").notNull(),
  input: text("input"),
  output: text("output"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
  resolvedBy: text("resolved_by")
});

// --- Skills (Anthropic-style: reusable capabilities attached to agents) ---
export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  content: text("content"),
  config: text("config"),
  createdAt: integer("created_at").notNull()
});

export const agentSkills = sqliteTable(
  "agent_skills",
  {
    agentId: text("agent_id").notNull(),
    skillId: text("skill_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    config: text("config"),
    createdAt: integer("created_at").notNull()
  },
  (t) => [primaryKey({ columns: [t.agentId, t.skillId] })]
);

// --- Run logs (agent/workflow execution logs; outputs already in executions.output) ---
export const runLogs = sqliteTable("run_logs", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  createdAt: integer("created_at").notNull()
});

// --- RAG: encoding config (user-configured; changing it requires re-encoding vectors) ---
export const ragEncodingConfigs = sqliteTable("rag_encoding_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  modelOrEndpoint: text("model_or_endpoint").notNull(),
  dimensions: integer("dimensions").notNull(),
  createdAt: integer("created_at").notNull()
});

// --- RAG: document store (MinIO, S3, GCS, etc.) ---
export const ragDocumentStores = sqliteTable("rag_document_stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  bucket: text("bucket").notNull(),
  region: text("region"),
  endpoint: text("endpoint"),
  credentialsRef: text("credentials_ref"),
  createdAt: integer("created_at").notNull()
});

// --- RAG: vector store (where vectors are stored per collection) ---
export const ragVectorStores = sqliteTable("rag_vector_stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: text("config"),
  createdAt: integer("created_at").notNull()
});

// --- RAG: collections (per-agent or deployment-wide) ---
export const ragCollections = sqliteTable("rag_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").notNull(),
  agentId: text("agent_id"),
  encodingConfigId: text("encoding_config_id").notNull(),
  documentStoreId: text("document_store_id").notNull(),
  vectorStoreId: text("vector_store_id"),
  createdAt: integer("created_at").notNull()
});

// --- RAG: bundled vectors (when no external vector store) ---
export const ragVectors = sqliteTable("rag_vectors", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull(),
  documentId: text("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  embedding: text("embedding").notNull(),
  createdAt: integer("created_at").notNull()
});

// --- RAG: documents (ingested; vectors stored in vector DB keyed by id) ---
export const ragDocuments = sqliteTable("rag_documents", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull(),
  externalId: text("external_id"),
  storePath: text("store_path").notNull(),
  mimeType: text("mime_type"),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull()
});

// --- RAG: connectors (Google Drive, Dropbox, etc.) ---
export const ragConnectors = sqliteTable("rag_connectors", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  collectionId: text("collection_id").notNull(),
  config: text("config").notNull(),
  status: text("status").notNull(),
  lastSyncAt: integer("last_sync_at"),
  createdAt: integer("created_at").notNull()
});

// --- Autonomous agent / improvement (plan §2.0) ---
export const improvementJobs = sqliteTable("improvement_jobs", {
  id: text("id").primaryKey(),
  name: text("name"),
  scopeType: text("scope_type"),
  scopeId: text("scope_id"),
  studentLlmConfigId: text("student_llm_config_id"),
  teacherLlmConfigId: text("teacher_llm_config_id"),
  currentModelRef: text("current_model_ref"),
  instanceRefs: text("instance_refs"),
  architectureSpec: text("architecture_spec"),
  lastTrainedAt: integer("last_trained_at"),
  lastFeedbackAt: integer("last_feedback_at"),
  createdAt: integer("created_at").notNull()
});

export const techniqueInsights = sqliteTable("technique_insights", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  runId: text("run_id"),
  techniqueOrStrategy: text("technique_or_strategy").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull(),
  config: text("config"),
  createdAt: integer("created_at").notNull()
});

export const techniquePlaybook = sqliteTable("technique_playbook", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  whenToUse: text("when_to_use"),
  downsides: text("downsides"),
  interactions: text("interactions"),
  observed: text("observed"),
  updatedAt: integer("updated_at").notNull()
});

export const guardrails = sqliteTable("guardrails", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  scopeId: text("scope_id"),
  config: text("config").notNull(),
  createdAt: integer("created_at").notNull()
});

export const agentStoreEntries = sqliteTable("agent_store_entries", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  scopeId: text("scope_id").notNull(),
  storeName: text("store_name").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: integer("created_at").notNull()
});

export const trainingRuns = sqliteTable("training_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  backend: text("backend").notNull(),
  status: text("status").notNull(),
  datasetRef: text("dataset_ref"),
  outputModelRef: text("output_model_ref"),
  config: text("config"),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at")
});

/** One-shot reminders. taskType: "message" = post static text to chat; "assistant_task" = insert user message and run one assistant turn. */
export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  runAt: integer("run_at").notNull(),
  message: text("message").notNull(),
  conversationId: text("conversation_id"),
  taskType: text("task_type").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  firedAt: integer("fired_at")
});
