import type { LLMConfig } from "./llm";
import type { Canvas } from "./canvas";

export type AgentKind = "node" | "code";

export type AgentType = "internal" | "external";

export type AgentProtocol = "mcp" | "http" | "native";

export type ScopeConfig = {
  name: string;
  allowed: boolean;
  description?: string;
};

export interface Agent {
  id: string;
  name: string;
  description?: string;
  kind: AgentKind;
  type: AgentType;
  protocol: AgentProtocol;
  endpoint?: string;
  agentKey?: string;
  capabilities: string[];
  scopes: ScopeConfig[];
  llmConfig?: LLMConfig;
  /** RAG: null/undefined = use studio (deployment) collection; set = use this collection for agent context */
  ragCollectionId?: string | null;
}

export interface NodeAgentDefinition {
  graph: Canvas;
  sharedContextKeys: string[];
  /** Default LLM config ID for nodes that don't specify llmConfigId. Resolved from llm_configs table. */
  defaultLlmConfigId?: string;
  /** Tool IDs for legacy llm nodes with decision layer. Prefer "decision" node type for per-node config. */
  toolIds?: string[];
}

export interface CodeAgent {
  source: string;
  entrypoint: string;
}

/** Per-node override for a tool (agent-specific customization without changing the library tool) */
export type ToolOverride = {
  config?: Record<string, unknown>;
  inputSchema?: unknown;
  name?: string;
};

export type AgentExecutionContext = {
  sharedContext: Record<string, unknown>;
  callTool: (toolId: string, input: unknown, override?: ToolOverride) => Promise<unknown>;
  /** callLLM accepts { llmConfigId?, messages, tools? }. llmConfigId selects which LLM to use (per-node). Returns LLMResponse when tools provided, else content string. */
  callLLM: (input: unknown) => Promise<unknown>;
  /** Build tool definitions for given tool IDs. Used by decision nodes. */
  buildToolsForIds?: (toolIds: string[]) => Promise<Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>>;
  /** Cached tool definitions (legacy). Prefer buildToolsForIds for per-node tools. */
  availableTools?: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
};
