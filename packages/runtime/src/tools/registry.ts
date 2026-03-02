/**
 * Tool registry: registers protocol-specific adapters and executes tools by delegating to the right adapter.
 * Use when adding a new tool protocol (implement ToolAdapter and register it) or when executing tools from chat/workflow.
 *
 * @packageDocumentation
 */

import type { ToolDefinition, ToolProtocol } from "@agentron-studio/core";
import type { ToolAdapter, ToolExecutionContext } from "./types";

/**
 * Registry of tool adapters per protocol. Executes tools by looking up the adapter for the tool's protocol.
 */
export class ToolRegistry {
  private adapters = new Map<ToolProtocol, ToolAdapter>();

  /**
   * Register an adapter for a protocol. Replaces any existing adapter for that protocol.
   * @param adapter - Adapter implementing execute() for the given protocol
   */
  registerAdapter(adapter: ToolAdapter) {
    this.adapters.set(adapter.protocol, adapter);
  }

  /**
   * Execute a tool by delegating to the adapter registered for the tool's protocol.
   * @param tool - Tool definition (id, name, protocol, config, schemas)
   * @param input - Tool input (opaque; adapter and tool define the shape)
   * @param context - Optional execution context (e.g. AbortSignal)
   * @returns Promise resolving to the tool result (adapter-defined)
   * @throws Error if no adapter is registered for the tool's protocol
   */
  async execute(tool: ToolDefinition, input: unknown, context?: ToolExecutionContext) {
    const adapter = this.adapters.get(tool.protocol);
    if (!adapter) {
      throw new Error(`No adapter registered for protocol ${tool.protocol}`);
    }
    return adapter.execute(tool, input, context);
  }
}
