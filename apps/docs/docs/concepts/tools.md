# Tools

## Definition

A **tool** is a callable capability that agents use to perform actions. Tools are first-class resources in Agentron: they are created, stored, and referenced by ID.

## Tool Protocols

| Protocol | Description |
|----------|-------------|
| **native** | Built-in or code-based. Implemented in the runtime (e.g. std-weather, std-fetch-url). |
| **http** | Calls an external URL. Config: `{ url, method }`. |
| **mcp** | Connects to an MCP (Model Context Protocol) server. |

## Tool Lifecycle

1. **Create** — `create_tool` with `name`, `protocol`, and optional `config` / `inputSchema`
2. **List** — `list_tools` returns all tools with `id`, `name`, `protocol`
3. **Get** — `get_tool(id)` returns full details (config, inputSchema, outputSchema)
4. **Update** — `update_tool` to change name, config, schemas. Standard tools (std-*) can only update inputSchema/outputSchema.

## How Agents Use Tools

- **Node agents** reference tools in two ways:
  - **Decision layer** (`toolIds`): The LLM receives tool definitions and decides per request whether to call a tool or respond directly. The agent can only decide on tools defined in `toolIds` (agent-level or per decision node).
  - **Tool nodes**: Unconditional tool calls in the graph (`parameters.toolId`).
- **Code agents** can call tools via the runtime API.
- Tool IDs from `list_tools` are used when creating/updating agents.

## Standard Tools (Built-in)

Agentron ships with standard tools such as:
- `std-weather` — weather data
- `std-fetch-url` — fetch URL content
- Others depending on installation

## Suggested User Actions

When a user wants to:
- **"Add a tool to my agent"** — Use `list_tools`, then `update_agent` with `toolIds` including the chosen tool IDs
- **"Create a custom HTTP tool"** — Use `create_tool` with `protocol: "http"` and `config: { url, method }`
- **"What tools are available?"** — Use `list_tools`
- **"Fix a tool"** — Use `get_tool(id)` first to diagnose, then `update_tool`
