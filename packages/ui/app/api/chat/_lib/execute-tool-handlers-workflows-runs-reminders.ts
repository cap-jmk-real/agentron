/**
 * Dispatcher for tool handlers: delegates to domain handler modules via a registry.
 * All tool names are routed to one of the 14 handler modules; no tools are implemented here.
 */
import type { ExecuteToolContext, ExecuteToolFn } from "./execute-tool-shared";
import { SANDBOX_TOOL_NAMES, handleSandboxTools } from "./execute-tool-handlers-sandbox";
import { WORKFLOW_TOOL_NAMES, handleWorkflowTools } from "./execute-tool-handlers-workflows";
import {
  CUSTOM_FUNCTIONS_TOOL_NAMES,
  handleCustomFunctionTools,
} from "./execute-tool-handlers-custom-functions";
import { RUNS_TOOL_NAMES, handleRunTools } from "./execute-tool-handlers-runs";
import { REMINDERS_TOOL_NAMES, handleReminderTools } from "./execute-tool-handlers-reminders";
import { STORES_TOOL_NAMES, handleStoreTools } from "./execute-tool-handlers-stores";
import { GUARDRAILS_TOOL_NAMES, handleGuardrailTools } from "./execute-tool-handlers-guardrails";
import { FILES_TOOL_NAMES, handleFileTools } from "./execute-tool-handlers-files";
import { WEB_TOOL_NAMES, handleWebTools } from "./execute-tool-handlers-web";
import { SHELL_TOOL_NAMES, handleShellTools } from "./execute-tool-handlers-shell";
import {
  REMOTE_SERVERS_TOOL_NAMES,
  handleRemoteServerTools,
} from "./execute-tool-handlers-remote-servers";
import { ASSISTANT_TOOL_NAMES, handleAssistantTools } from "./execute-tool-handlers-assistant";
import {
  IMPROVEMENT_TOOL_NAMES,
  handleImprovementTools,
} from "./execute-tool-handlers-improvement";
import { OPENCLAW_TOOL_NAMES, handleOpenClawTools } from "./execute-tool-handlers-openclaw";

export type { ExecuteToolFn } from "./execute-tool-shared";

type HandlerFn = (
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined,
  executeToolRef?: ExecuteToolFn
) => Promise<unknown>;

const HANDLER_REGISTRY: Array<{
  names: readonly string[];
  handler: HandlerFn;
  passExecuteToolRef?: boolean;
}> = [
  { names: SANDBOX_TOOL_NAMES, handler: handleSandboxTools },
  { names: WORKFLOW_TOOL_NAMES, handler: handleWorkflowTools },
  { names: CUSTOM_FUNCTIONS_TOOL_NAMES, handler: handleCustomFunctionTools },
  { names: RUNS_TOOL_NAMES, handler: handleRunTools },
  { names: REMINDERS_TOOL_NAMES, handler: handleReminderTools },
  { names: STORES_TOOL_NAMES, handler: handleStoreTools },
  { names: GUARDRAILS_TOOL_NAMES, handler: handleGuardrailTools },
  { names: FILES_TOOL_NAMES, handler: handleFileTools },
  { names: WEB_TOOL_NAMES, handler: handleWebTools },
  { names: SHELL_TOOL_NAMES, handler: handleShellTools },
  { names: REMOTE_SERVERS_TOOL_NAMES, handler: handleRemoteServerTools },
  { names: ASSISTANT_TOOL_NAMES, handler: handleAssistantTools },
  { names: IMPROVEMENT_TOOL_NAMES, handler: handleImprovementTools, passExecuteToolRef: true },
  { names: OPENCLAW_TOOL_NAMES, handler: handleOpenClawTools },
];

export async function executeToolHandlersWorkflowsRunsReminders(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined,
  executeToolRef?: ExecuteToolFn
): Promise<unknown | undefined> {
  for (const { names, handler, passExecuteToolRef } of HANDLER_REGISTRY) {
    if ((names as readonly string[]).includes(name)) {
      const result = await handler(name, a, ctx, passExecuteToolRef ? executeToolRef : undefined);
      return result === undefined ? undefined : result;
    }
  }
  return undefined;
}
