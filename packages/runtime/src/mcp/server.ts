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
        inputSchema: z.any(),
      },
      async (input) => {
        const output = await handler(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output ?? {}),
            },
          ],
          structuredContent: output ?? {},
        };
      }
    );
  }

  createExpressApp() {
    const app = createMcpExpressApp();
    type Req = { body: unknown };
    type Res = {
      on(event: string, cb: () => void): void;
      headersSent: boolean;
      status(n: number): { json: (x: unknown) => void };
    };
    app.post("/mcp", async (req: unknown, res: unknown) => {
      const reqTyped = req as Req;
      const resObj = res as Res;
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await this.server.connect(transport);
        await transport.handleRequest(reqTyped, resObj, reqTyped.body);
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
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });
    return app;
  }
}
