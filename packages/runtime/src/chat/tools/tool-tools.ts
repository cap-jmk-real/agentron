import type { AssistantToolDef } from "./types";

export const TOOL_TOOLS: AssistantToolDef[] = [
  {
    name: "get_specialist_options",
    description: "Query the heap for structured options (option groups) for one or all specialists. Returns optionGroups (e.g. observe, act_prompt, act_training, evaluate) so you judge meaning and choose groups instead of judging a full tool list. Call with no arguments to list all top-level specialists and their option groups; call with specialistId (e.g. 'improvement') to get that specialist's groups. Only available in heap mode.",
    parameters: {
      type: "object",
      properties: {
        specialistId: { type: "string", description: "Optional: specialist id (e.g. improvement, agent). Omit to get options for all top-level specialists." },
      },
      required: [],
    },
  },
  {
    name: "list_tools",
    description: "List tools in the studio (id, name, protocol). Use category to get a shorter list: vault, web, browser, containers, files, user_input, improvement. For improvement, use subset to get a small relevant list: 'observe' = get_run_for_improvement, get_feedback_for_scope; 'prompt' = prompt-adjustment tools only (get_agent, update_agent, apply_agent_prompt_improvement, etc.); 'topology' = workflow/agent graph tools only (get_workflow, update_workflow, list_workflows, etc.); 'prompt_and_topology' = observe + prompt + topology (no model training tools); 'training' = jobs, generate_training_data, trigger_training, etc. (13 tools). Omit subset or use no category to get all tools. Call before create_agent when agents need capabilities; use returned ids in toolIds.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional: vault | web | browser | containers | files | user_input | improvement." },
        subset: { type: "string", description: "When category is 'improvement': 'observe' (run/feedback); 'prompt' (prompt-adjustment only); 'topology' (workflow/agent graph only); 'prompt_and_topology' (observe + prompt + topology, no model training); 'training' (jobs and training pipeline). Omit for all improvement tools." },
      },
      required: [],
    },
  },
  {
    name: "get_tool",
    description: "Get full details of a tool by ID (name, protocol, config, inputSchema). Use before update_tool when fixing a tool.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Tool ID" } },
      required: ["id"],
    },
  },
  {
    name: "update_tool",
    description: "Update an existing tool. Use when fixing a tool — set name, config, inputSchema, outputSchema. Standard tools (std-*) can only update inputSchema/outputSchema.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Tool ID" },
        name: { type: "string" },
        config: { type: "object", description: "Tool config (e.g. HTTP: { url, method }, MCP: server config)" },
        inputSchema: { type: "object", description: "JSON Schema for tool input" },
        outputSchema: { type: "object", description: "JSON Schema for tool output" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_tool",
    description: "Create a new tool and save it to the database. Tools can be native (built-in/code), HTTP (call a URL), or MCP. The tool will appear in the studio sidebar under Tools and can be attached to agents.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tool name" },
        protocol: { type: "string", enum: ["native", "mcp", "http"], description: "native = built-in/code, http = call URL, mcp = MCP server" },
        config: { type: "object", description: "For HTTP: { url, method }. For MCP: server config. Optional." },
        inputSchema: { type: "object", description: "JSON Schema for tool input (optional)" },
      },
      required: ["name"],
    },
  },
];
