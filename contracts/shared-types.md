# Shared Types (Studio)

The following types are shared between Studio and Server.

```ts
export type AgentKind = "node" | "code";

export type AgentType = "internal" | "external";

export type AgentProtocol = "mcp" | "http" | "native";

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
}

export interface NodeAgentDefinition {
  graph: { nodes: AgentNode[]; edges: Edge[] };
  sharedContextKeys: string[];
  /** Default LLM config ID for nodes that don't specify llmConfigId. */
  defaultLlmConfigId?: string;
  /** Tool IDs for decision layer (LLM/decision nodes). Agent can only decide on tools in this list. */
  toolIds?: string[];
}

export interface CodeAgent {
  source: string;
  entrypoint: string;
}

export type LLMProvider =
  | "local"
  | "openai"
  | "anthropic"
  | "azure"
  | "gcp"
  | "custom_http";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKeyRef?: string;
  endpoint?: string;
  extra?: Record<string, any>;
}
```

