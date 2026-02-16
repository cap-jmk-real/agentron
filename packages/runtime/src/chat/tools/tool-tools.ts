import type { AssistantToolDef } from "./types";

export const TOOL_TOOLS: AssistantToolDef[] = [
  {
    name: "list_tools",
    description: "List all tools available in the studio. Returns id, name, protocol for each tool. Call this before create_agent when agents need capabilities (e.g. weather → std-weather, search the web → std-web-search, fetch a URL → std-fetch-url, run container → std-container-run, HTTP fetch → corresponding tool). Use the returned ids in toolIds when creating/updating agents. Standard tools include std-weather, std-web-search, std-fetch-url, std-browser-automation (navigate/click/fill/getContent via Chrome CDP — use for 'get list from web then ask user which one' together with std-request-user-help; browser first, then request_user_help), std-container-run, and std-request-user-help. Add std-request-user-help ONLY when a workflow agent must pause for user input (confirmation, choice, credentials) — the run stops until the user responds. For 'get list from website then ask me which one': include std-browser-automation or std-fetch-url AND std-request-user-help; order is browser/fetch first, then request_user_help. Do not add std-request-user-help for agents that do not need to pause.",
    parameters: { type: "object", properties: {}, required: [] },
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
