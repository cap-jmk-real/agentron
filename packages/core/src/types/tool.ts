export type ToolProtocol = "mcp" | "http" | "native";

export interface ToolDefinition {
  id: string;
  name: string;
  protocol: ToolProtocol;
  config: Record<string, unknown>;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
