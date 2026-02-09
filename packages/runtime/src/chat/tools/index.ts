import type { AssistantToolDef } from "./types";
import { AGENT_TOOLS } from "./agent-tools";
import { TOOL_TOOLS } from "./tool-tools";
import { WORKFLOW_TOOLS } from "./workflow-tools";
import { MISC_TOOLS } from "./misc-tools";
import { REMOTE_TOOLS } from "./remote-tools";
import { CONVERSATION_TOOLS } from "./conversation-tools";

export type { AssistantToolDef } from "./types";
export { SYSTEM_PROMPT } from "./prompt";

/** All assistant tools combined. Add new domain modules above and include them here. */
export const ASSISTANT_TOOLS: AssistantToolDef[] = [
  ...AGENT_TOOLS,
  ...TOOL_TOOLS,
  ...WORKFLOW_TOOLS,
  ...MISC_TOOLS,
  ...REMOTE_TOOLS,
  ...CONVERSATION_TOOLS,
];
