/**
 * Tool execution types: context passed to adapters and the ToolAdapter interface.
 * Implement ToolAdapter to add a new tool protocol; pass ToolExecutionContext from callers.
 *
 * @packageDocumentation
 */

import type { ToolDefinition, ToolProtocol } from "@agentron-studio/core";

/** Optional context passed when executing a tool (e.g. for cancellation). */
export type ToolExecutionContext = {
  signal?: AbortSignal;
};

/**
 * Adapter interface for executing tools of a given protocol.
 * Register an implementation with ToolRegistry.registerAdapter() to support that protocol.
 */
export interface ToolAdapter {
  /** Protocol this adapter handles (e.g. "native", "http", "mcp"). */
  protocol: ToolProtocol;
  /**
   * Execute the tool with the given input and optional context.
   * @param tool - Tool definition
   * @param input - Tool input (shape defined by the tool)
   * @param context - Optional execution context
   * @returns Promise resolving to the tool result
   */
  execute: (
    tool: ToolDefinition,
    input: unknown,
    context?: ToolExecutionContext
  ) => Promise<unknown>;
}

/** Handler for a native (in-process) tool: accepts input, returns result. */
export type NativeToolHandler = (input: unknown) => Promise<unknown>;
