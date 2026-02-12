import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express";
import * as z from "zod/v4";

export type MCPToolHandler = (input: unknown) => Promise<unknown>;

export class MCPServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({ name: "agentron-studio", version: "0.1.0" });
  }

  registerTool(name: string, handler: MCPToolHandler) {
    this.server.registerTool(
      name,
      {
        description: `AgentOS tool ${name}`,
        inputSchema: z.any()
      },
      async (input) => {
        const output = await handler(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output ?? {})
            }
          ],
          structuredContent: output ?? {}
        };
      }
    );
  }

  createExpressApp() {
    const app = createMcpExpressApp();
    app.post("/mcp", async (req, res) => {
      const resObj = res as { on(event: string, cb: () => void): void; headersSent: boolean; status(n: number): { json: (x: unknown) => void }; };
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        });
        await this.server.connect(transport);
        await transport.handleRequest(req, res, (req as { body: unknown }).body);
        resObj.on("close", () => {
          transport.close();
          this.server.close();
        });
      } catch (error) {
        if (!resObj.headersSent) {
          resObj.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null
          });
        }
      }
    });
    return app;
  }
}
