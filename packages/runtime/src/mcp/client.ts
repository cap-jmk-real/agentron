import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";

export type MCPToolCall = {
  toolName: string;
  input: unknown;
};

export class MCPClient {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;

  constructor(private endpoint: string) {}

  private async connect() {
    if (this.client) {
      return;
    }
    this.client = new Client({ name: "agentron-studio", version: "0.1.0" });
    this.transport = new StreamableHTTPClientTransport(new URL(this.endpoint));
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
      arguments: call.input ?? {}
    });
    return result;
  }
}
