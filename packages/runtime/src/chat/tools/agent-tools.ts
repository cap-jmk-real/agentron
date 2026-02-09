import type { AssistantToolDef } from "./types";

export const AGENT_TOOLS: AssistantToolDef[] = [
  {
    name: "list_agents",
    description: "List all agents in the studio",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_llm_providers",
    description: "List available LLM providers (id, provider, model). Use when creating an agent — if the user hasn't chosen an LLM, suggest these options and ask them to select one before creating. Do NOT create agents without LLM config when they need one.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_agent",
    description: "Create a new agent. For node agents: require name, description, llmConfigId, graphNodes (at least one 'llm' node with parameters.systemPrompt). CRITICAL — Decision layer: when the agent needs to use tools (weather, fetch URL, run code, etc.), you MUST include toolIds. toolIds enable the decision layer: the LLM decides per request whether to call a tool or respond directly. Without toolIds, the agent cannot use tools. Add toolIds from list_tools (e.g. std-weather, std-fetch-url, std-run-code). Use graphEdges when multiple nodes: [{id, source, target}]. All changes are persisted.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name" },
        kind: { type: "string", enum: ["node", "code"], description: "Agent kind" },
        protocol: { type: "string", enum: ["native", "mcp", "http"], description: "Protocol" },
        description: { type: "string", description: "Short description of what the agent does (required)" },
        systemPrompt: { type: "string", description: "System prompt — use in llm node parameters when building graphNodes" },
        llmConfigId: { type: "string", description: "ID of LLM provider from list_llm_providers. Required for node agents." },
        toolIds: { type: "array", items: { type: "string" }, description: "Tool IDs from list_tools when agent needs tools." },
        graphNodes: { type: "array", description: "Agent graph nodes. Each: { id, type: 'llm'|'decision'|'tool'|'context_read'|'context_write'|'input'|'output', position: [x,y], parameters }. llm: systemPrompt, llmConfigId?. decision: systemPrompt, llmConfigId (required), toolIds (per-node). tool: toolId." },
        graphEdges: { type: "array", description: "Agent graph edges: [{ id, source: nodeId, target: nodeId }]. Execution order follows edges." },
      },
      required: ["name"],
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
    description: "Update an existing agent. Use when fixing — set name, description, systemPrompt, llmConfigId, toolIds, graphNodes, graphEdges.",
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
