import type { AssistantToolDef } from "./types";
import { AGENT_TOOLS } from "./agent-tools";
import { TOOL_TOOLS } from "./tool-tools";
import { WORKFLOW_TOOLS } from "./workflow-tools";
import { MISC_TOOLS } from "./misc-tools";
import { REMOTE_TOOLS } from "./remote-tools";
import { CONVERSATION_TOOLS } from "./conversation-tools";
import { IMPROVEMENT_TOOLS } from "./improvement-tools";
import { STORE_TOOLS } from "./store-tools";
import { GUARDRAIL_TOOLS } from "./guardrail-tools";
import { OPENCLAW_TOOLS } from "./openclaw-tools";
import { REMINDER_TOOLS } from "./reminder-tools";
import { OPENAPI_TOOLS } from "./openapi-tools";
import { HEAP_TOOLS } from "./heap-tools";
import { CUSTOM_FUNCTION_TOOLS } from "./custom-function-tools";
import { CONNECTOR_TOOLS } from "./connector-tools";

export type { AssistantToolDef } from "./types";
export { SYSTEM_PROMPT, BLOCK_AGENTIC_PATTERNS, BLOCK_DESIGN_AGENTS } from "./prompt";

/** All assistant tools combined. Add new domain modules above and include them here. */
export const ASSISTANT_TOOLS: AssistantToolDef[] = [
  ...AGENT_TOOLS,
  ...TOOL_TOOLS,
  ...HEAP_TOOLS,
  ...OPENAPI_TOOLS,
  ...CUSTOM_FUNCTION_TOOLS,
  ...CONNECTOR_TOOLS,
  ...WORKFLOW_TOOLS,
  ...MISC_TOOLS,
  ...REMOTE_TOOLS,
  ...CONVERSATION_TOOLS,
  ...IMPROVEMENT_TOOLS,
  ...STORE_TOOLS,
  ...GUARDRAIL_TOOLS,
  ...OPENCLAW_TOOLS,
  ...REMINDER_TOOLS,
];
