import type { AssistantToolDef } from "./types";

export const OPENCLAW_TOOLS: AssistantToolDef[] = [
  {
    name: "send_to_openclaw",
    description:
      "Send a message or command to the user's OpenClaw instance (personal AI assistant gateway). Use when the user wants to ask OpenClaw to do something, e.g. check calendar, send an email, or run a task. OpenClaw must be running (Gateway at OPENCLAW_GATEWAY_URL, default ws://127.0.0.1:18789).",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The message or command to send to OpenClaw (e.g. 'Check my calendar for tomorrow', 'Send an email to ...')",
        },
        gatewayUrl: {
          type: "string",
          description:
            "Override gateway URL for this call (e.g. ws://127.0.0.1:<hostPort>); use when multiple OpenClaw containers are run and you need to target one.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "openclaw_history",
    description:
      "Get the recent chat history from the user's OpenClaw instance so you can summarize what OpenClaw said or did. Use when the user asks 'what did OpenClaw say?' or 'what did OpenClaw do?' or to get context before sending a new command.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of messages to return (default 20)" },
        gatewayUrl: {
          type: "string",
          description:
            "Override gateway URL for this call (e.g. ws://127.0.0.1:<hostPort>); use when multiple OpenClaw containers are run.",
        },
      },
      required: [],
    },
  },
  {
    name: "openclaw_abort",
    description:
      "Abort or stop the current run in the user's OpenClaw instance. Use when the user wants to stop what OpenClaw is doing.",
    parameters: {
      type: "object",
      properties: {
        gatewayUrl: {
          type: "string",
          description:
            "Override gateway URL for this call (e.g. ws://127.0.0.1:<hostPort>); use when multiple OpenClaw containers are run.",
        },
      },
      required: [],
    },
  },
];
