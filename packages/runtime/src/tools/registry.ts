import type { ToolDefinition, ToolProtocol } from "@agentron-studio/core";
import type { ToolAdapter, ToolExecutionContext } from "./types";

export class ToolRegistry {
  private adapters = new Map<ToolProtocol, ToolAdapter>();

  registerAdapter(adapter: ToolAdapter) {
    this.adapters.set(adapter.protocol, adapter);
  }

  async execute(tool: ToolDefinition, input: unknown, context?: ToolExecutionContext) {
    const adapter = this.adapters.get(tool.protocol);
    if (!adapter) {
      throw new Error(`No adapter registered for protocol ${tool.protocol}`);
    }
    return adapter.execute(tool, input, context);
  }
}
