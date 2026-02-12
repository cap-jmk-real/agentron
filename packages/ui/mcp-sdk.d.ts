/** Type declarations for MCP SDK subpath exports (bundler does not resolve .d.ts from path-mapped .js). */
declare module "@modelcontextprotocol/sdk/server/mcp" {
  export class McpServer {
    constructor(options: { name: string; version: string });
    registerTool(
      name: string,
      schema: { description: string; inputSchema: unknown },
      handler: (input: unknown) => Promise<{ content: Array<{ type: string; text: string }>; structuredContent?: unknown }>
    ): void;
    connect(transport: unknown): Promise<void>;
    close(): void;
  }
}

declare module "@modelcontextprotocol/sdk/server/streamableHttp" {
  export class StreamableHTTPServerTransport {
    constructor(options?: { sessionIdGenerator?: () => string });
    handleRequest(req: unknown, res: unknown, body: unknown): Promise<void>;
    close(): void;
  }
}

declare module "@modelcontextprotocol/sdk/server/express" {
  export function createMcpExpressApp(): {
    post(path: string, handler: (req: unknown, res: unknown) => void | Promise<void>): void;
  };
}
