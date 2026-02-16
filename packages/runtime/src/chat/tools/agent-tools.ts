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
    description: "Create a new agent. REQUIRED: name, description, llmConfigId, graphNodes with at least one 'llm' node (parameters.systemPrompt = concrete role/behavior). When the agent uses tools: pass toolIds AND add tool nodes plus graphEdges from each llm node to each tool node — so users see which tools each LLM can call. The system auto-injects missing tool nodes when toolIds are provided. Node agents need an LLM to decide when/how to call tools — even 'agent that runs container' requires an LLM. All changes are persisted.",
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
        graphNodes: { type: "array", description: "Agent graph nodes. Each llm: { id, type: 'llm', position: [x,y], parameters: { systemPrompt } }. Each tool: { id, type: 'tool', position: [x,y], parameters: { toolId } }. Add tool nodes when toolIds are provided so users see which tools each LLM uses." },
        graphEdges: { type: "array", description: "Edges between nodes: [{ id, source: nodeId, target: nodeId }]. Connect each llm node to each tool node (source: llm id, target: tool id) to show decision flow." },
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
    description: "Update an existing agent. Set name, description, systemPrompt, llmConfigId, graphNodes, graphEdges. When the agent should use tools, always set toolIds (array of ids from list_tools). Omitting toolIds leaves the agent with no tools. Use learningConfig to set per-agent limits for apply_agent_prompt_improvement: maxDerivedGood, maxDerivedBad, minCombinedFeedback, recentExecutionsLimit.",
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
        learningConfig: {
          type: "object",
          description: "Per-agent limits for self-learning (apply_agent_prompt_improvement). Persisted on the agent.",
          properties: {
            maxDerivedGood: { type: "number", description: "Max good examples from runs (default 20)" },
            maxDerivedBad: { type: "number", description: "Max bad examples from runs (default 20)" },
            minCombinedFeedback: { type: "number", description: "Min combined feedback to refine (default 1)" },
            recentExecutionsLimit: { type: "number", description: "Max recent runs to consider (default 50)" },
          },
        },
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
  {
    name: "apply_agent_prompt_improvement",
    description: "Improve an agent's system prompt from feedback and/or execution history (errors and successes from workflow runs). Returns a suggested prompt and optionally applies it. Use when the agent should self-learn without user input. Learning limits can be set per agent via update_agent(learningConfig: { maxDerivedGood, maxDerivedBad, minCombinedFeedback, recentExecutionsLimit }); or overridden for this call with the optional parameters below.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID to improve" },
        autoApply: { type: "boolean", description: "If true, persist the refined prompt to the agent; if false, only return the suggestion (default false)" },
        includeExecutionHistory: { type: "boolean", description: "If true, derive good/bad examples from recent workflow runs where this agent participated (default true)" },
        maxDerivedGood: { type: "number", description: "Max number of good examples to derive from runs (overrides agent learningConfig; default 20)" },
        maxDerivedBad: { type: "number", description: "Max number of bad examples to derive from runs (overrides agent learningConfig; default 20)" },
        minCombinedFeedback: { type: "number", description: "Minimum combined feedback items (explicit + from runs) required to refine (overrides agent learningConfig; default 1)" },
        recentExecutionsLimit: { type: "number", description: "Max number of recent workflow runs to consider (overrides agent learningConfig; default 50)" },
      },
      required: ["agentId"],
    },
  },
];
