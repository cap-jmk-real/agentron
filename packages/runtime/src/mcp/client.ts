import { Client } from "@modelcontextprotocol/sdk/client";

export type MCPToolCall = {
  toolName: string;
  input: unknown;
};

/** Transport interface compatible with MCP Client.connect() */
type MCPTransport = {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: unknown): Promise<void>;
};

async function createStreamableTransport(url: URL): Promise<MCPTransport> {
  // SDK subpath has no bundled type declarations; use type assertion
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@modelcontextprotocol/sdk/client/streamableHttp") as {
    StreamableHTTPClientTransport: new (url: URL) => MCPTransport;
  };
  return new mod.StreamableHTTPClientTransport(url);
}

export class MCPClient {
  private client?: Client;
  private transport?: MCPTransport;

  constructor(private endpoint: string) {}

  private async connect() {
    if (this.client) {
      return;
    }
    this.client = new Client({ name: "agentron-studio", version: "0.1.0" });
    this.transport = await createStreamableTransport(new URL(this.endpoint));
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<string[]> {
    await this.connect();
    const result = await this.client!.listTools();
    return result.tools.map((tool) => tool.name);
  }

  async callTool(call: MCPToolCall): Promise<unknown> {
    await this.connect();
    const result = await this.client!.callTool({
      name: call.toolName,
      arguments: (call.input ?? {}) as Record<string, unknown>,
    });
    return result;
  }
}
