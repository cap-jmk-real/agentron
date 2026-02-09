import type { ToolDefinition, ToolProtocol } from "@agentron-studio/core";

export type ToolExecutionContext = {
  signal?: AbortSignal;
};

export interface ToolAdapter {
  protocol: ToolProtocol;
  execute: (
    tool: ToolDefinition,
    input: unknown,
    context?: ToolExecutionContext
  ) => Promise<unknown>;
}

export type NativeToolHandler = (input: unknown) => Promise<unknown>;
