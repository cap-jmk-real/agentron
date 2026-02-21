import type { AssistantToolDef } from "./types";

export const REMINDER_TOOLS: AssistantToolDef[] = [
  {
    name: "create_reminder",
    description:
      "Create a one-shot reminder that fires at a specific time or in N minutes. Use when the user says 'remind me in 20 minutes to …', 'remind me at 3pm', or 'at 9am have the assistant summarize my calendar'. taskType: 'message' = post static text to chat; 'assistant_task' = run the assistant with the message as the user prompt (e.g. schedule a task for the assistant). For assistant_task you must be in a conversation so the reply appears there.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "The reminder text. For message: shown as 'Reminder: …'. For assistant_task: sent as the user message so the assistant runs (e.g. 'Summarize my calendar', 'Check the weather').",
        },
        at: {
          type: "string",
          description:
            "ISO 8601 date/time when the reminder should fire (e.g. '2026-02-16T15:00:00Z'). Use when the user specifies an exact time.",
        },
        inMinutes: {
          type: "number",
          description:
            "Minutes from now when the reminder should fire. Use when the user says 'in 20 minutes', 'in 1 hour' (use 60), etc.",
        },
        taskType: {
          type: "string",
          enum: ["message", "assistant_task"],
          description:
            "Default: message. Use assistant_task when the user wants the assistant to do something at that time (e.g. 'at 9am have the assistant check my calendar').",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "list_reminders",
    description:
      "List reminders. Use when the user asks 'what reminders do I have?', 'show my reminders', 'list reminders'. Returns pending reminders by default.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "fired", "cancelled"],
          description: "Filter by status (default: pending)",
        },
      },
      required: [],
    },
  },
  {
    name: "cancel_reminder",
    description:
      "Cancel a pending reminder by id. Use when the user says 'cancel that reminder', 'remove the reminder', 'don't remind me'. Get reminder ids from list_reminders.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Reminder ID (from create_reminder or list_reminders)" },
      },
      required: ["id"],
    },
  },
];
