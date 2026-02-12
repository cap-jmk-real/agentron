import type { AssistantToolDef } from "./types";

export const AGENT_TOOLS: AssistantToolDef[] = [
  {
    name: "list_agents",
    description: "List all agents in the studio",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_llm_providers",
    description: "List available LLM providers (id, provider, model). Call this when the user wants to create agents but has not specified which LLM to use; then ask them to pick one (by id or number) and do NOT call create_agent until they reply. If the chat has a selected LLM, you may use that when they say 'same' or 'default'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_agent",
    description: "Create a new agent. REQUIRED for proper behavior: name, description, llmConfigId, and graphNodes with at least one 'llm' node where parameters.systemPrompt is a concrete, non-empty string describing the agent's role and how it should behave (e.g. 'You are a research assistant. Summarize documents and suggest follow-up questions.'). Never omit or use a placeholder for systemPrompt — without it the agent will not behave properly. When the agent must use tools, also pass toolIds (array of ids from list_tools). For workflows, give every participating agent the toolIds it needs. Example llm node: { id: \"n1\", type: \"llm\", position: [100,100], parameters: { systemPrompt: \"You are [role]. [Concrete behavior.]\" } }. All changes are persisted. Create as many agents as the user requested (one create_agent call per agent).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name" },
        kind: { type: "string", enum: ["node", "code"], description: "Agent kind" },
        protocol: { type: "string", enum: ["native", "mcp", "http"], description: "Protocol" },
        description: { type: "string", description: "Short description of what the agent does (required)" },
        systemPrompt: { type: "string", description: "REQUIRED for node agents. Concrete system prompt defining the agent's role and behavior. Also set this in each llm node's parameters.systemPrompt in graphNodes. Example: 'You are a helpful assistant that answers questions concisely.'" },
        llmConfigId: { type: "string", description: "ID of LLM provider from list_llm_providers. Required for node agents." },
        toolIds: { type: "array", items: { type: "string" }, description: "REQUIRED when agent uses tools. IDs from list_tools." },
        graphNodes: { type: "array", description: "Agent graph nodes. Each llm node MUST have parameters.systemPrompt (concrete string). Format: { id, type: 'llm', position: [x,y], parameters: { systemPrompt: \"...\" } }." },
        graphEdges: { type: "array", description: "Agent graph edges: [{ id, source: nodeId, target: nodeId }]." },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "get_agent",
    description: "Get full details of an agent by ID (name, description, definition with systemPrompt, toolIds, graph). Use before update_agent when fixing or modifying an agent.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Agent ID" } },
      required: ["id"],
    },
  },
  {
    name: "update_agent",
    description: "Update an existing agent. Set name, description, systemPrompt, llmConfigId, graphNodes, graphEdges. When the agent should use tools, always set toolIds (array of ids from list_tools). Omitting toolIds leaves the agent with no tools.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Agent ID" },
        name: { type: "string" },
        description: { type: "string" },
        systemPrompt: { type: "string" },
        llmConfigId: { type: "string", description: "LLM provider ID from list_llm_providers" },
        toolIds: { type: "array", items: { type: "string" } },
        graphNodes: { type: "array", description: "Graph nodes: [{ id, type, position: [x,y], parameters? }]. decision node: llmConfigId, toolIds, systemPrompt." },
        graphEdges: { type: "array", description: "Graph edges: [{ id, source, target }]" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_agent",
    description: "Delete an agent by ID",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];
