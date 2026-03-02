/**
 * Agent types: node-based (graph) agents, code agents, and execution context.
 * Used by the runtime and API for agent CRUD, execution, and workflow node handlers.
 *
 * @packageDocumentation
 */

import type { LLMConfig } from "./llm";
import type { Canvas } from "./canvas";

/** Agent implementation kind: graph-based (node) or code-based (script). */
export type AgentKind = "node" | "code";

/** Whether the agent is internal (Studio-managed) or external (e.g. remote MCP). */
export type AgentType = "internal" | "external";

/** Protocol used to invoke the agent: native (in-process), HTTP, or MCP. */
export type AgentProtocol = "mcp" | "http" | "native";

/** Scope permission: name, whether allowed, optional description. */
export type ScopeConfig = {
  name: string;
  allowed: boolean;
  description?: string;
};

/**
 * Agent entity: identity, kind, protocol, capabilities, and optional LLM/RAG config.
 * Stored in DB and used by API and runtime for execution and listing.
 */
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

/**
 * Definition for a node (graph) agent: canvas graph, shared context keys, and optional default LLM/tool config.
 * Resolved at runtime when running the agent's graph.
 */
export interface NodeAgentDefinition {
  graph: Canvas;
  sharedContextKeys: string[];
  /** Default LLM config ID for nodes that don't specify llmConfigId. Resolved from llm_configs table. */
  defaultLlmConfigId?: string;
  /** Tool IDs for legacy llm nodes with decision layer. Prefer "decision" node type for per-node config. */
  toolIds?: string[];
}

/** Definition for a code agent: source code and entrypoint (e.g. default export or main). */
export interface CodeAgent {
  source: string;
  entrypoint: string;
}

/**
 * Per-node override for a tool: agent-specific config/schema/name without changing the library tool.
 */
export type ToolOverride = {
  config?: Record<string, unknown>;
  inputSchema?: unknown;
  name?: string;
};

/**
 * Execution context passed to node agents and workflow node handlers.
 * Provides shared context, callTool, callLLM, and optional tool definitions / RAG/tool instruction blocks.
 */
export type AgentExecutionContext = {
  sharedContext: Record<string, unknown>;
  callTool: (toolId: string, input: unknown, override?: ToolOverride) => Promise<unknown>;
  /** callLLM accepts { llmConfigId?, messages, tools? }. llmConfigId selects which LLM to use (per-node). Returns LLMResponse when tools provided, else content string. */
  callLLM: (input: unknown) => Promise<unknown>;
  /** Build tool definitions for given tool IDs. Used by decision nodes. */
  buildToolsForIds?: (toolIds: string[]) => Promise<
    Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>
  >;
  /** Cached tool definitions (legacy). Prefer buildToolsForIds for per-node tools. */
  availableTools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  /** Optional workflow/RAG block to prepend to user message (workflow runner sets this). */
  ragBlock?: string;
  /** Optional tool instructions block to prepend to user message (workflow runner sets this). */
  toolInstructionsBlock?: string;
};
