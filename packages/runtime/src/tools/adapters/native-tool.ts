import type { ToolDefinition } from "@agentron-studio/core";
import type { ToolAdapter, NativeToolHandler } from "../types";

export class NativeToolAdapter implements ToolAdapter {
  protocol: "native" = "native";
  private handlers = new Map<string, NativeToolHandler>();

  register(toolId: string, handler: NativeToolHandler) {
    this.handlers.set(toolId, handler);
  }

  async execute(tool: ToolDefinition, input: unknown) {
    const config = tool.config as { baseToolId?: string } | undefined;
    const handlerId = config?.baseToolId ?? tool.id;
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`No native handler registered for tool ${handlerId}`);
    }
    return handler(input);
  }
}
