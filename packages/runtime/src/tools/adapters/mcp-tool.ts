import type { ToolAdapter } from "../types";
import { MCPClient } from "../../mcp/client";

type MCPToolConfig = {
  endpoint: string;
  toolName: string;
};

export const mcpToolAdapter: ToolAdapter = {
  protocol: "mcp",
  execute: async (tool, input) => {
    const config = tool.config as MCPToolConfig;
    if (!config?.endpoint || !config?.toolName) {
      throw new Error("MCP tool requires endpoint and toolName in config.");
    }

    const client = new MCPClient(config.endpoint);
    return client.callTool({
      toolName: config.toolName,
      input: input ?? {},
    });
  },
};
