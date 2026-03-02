/**
 * Tool types: protocol and tool definition.
 * Used by the tool registry, adapters, and API for tool CRUD and execution.
 *
 * @packageDocumentation
 */

/** Protocol used to execute the tool: native (in-process), HTTP, or MCP. */
export type ToolProtocol = "mcp" | "http" | "native";

/**
 * Tool definition: identity, name, protocol, and config/schemas.
 * Stored in DB and passed to the ToolRegistry for execution via the adapter for the tool's protocol.
 */
export interface ToolDefinition {
  id: string;
  name: string;
  protocol: ToolProtocol;
  config: Record<string, unknown>;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
