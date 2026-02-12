import type { AssistantToolDef } from "./types";

export const CONVERSATION_TOOLS: AssistantToolDef[] = [
  {
    name: "ask_user",
    description:
      "Ask the user for information or confirmation before proceeding. Use when you need: a choice (e.g. which cities, which LLM when multiple), confirmation of a plan, or any missing detail you cannot infer. Call this with a clear, specific question. In the SAME response do NOT output any create_*, update_*, or execute_workflow tool calls — only ask_user and your short message. Wait for the user's reply before creating or updating resources.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Clear question to show the user (e.g. 'Which LLM should I use for these agents — 1. OpenAI gpt-4, 2. Ollama llama3?' or 'Confirm: create 3 agents and 2 workflows?')" },
        reason: { type: "string", description: "Optional one-line reason (e.g. 'Need to pick LLM before creating agents')" },
      },
      required: ["question"],
    },
  },
  {
    name: "retry_last_message",
    description: "Get the last user message in this conversation so you can respond to it again. Use when the user asks to retry, redo, or repeat the last message (e.g. 'retry the last message', 'try again', 'redo', 'run that again'). Call this tool, then respond to the returned lastUserMessage in your reply.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "remember",
    description: "Store a preference or fact the user stated so it can be used in future chats (e.g. 'prefer Ollama for local', 'main workflow is X'). Use when the user explicitly tells you to remember something or states a clear preference. Key is optional (e.g. 'default_llm'); if omitted, the content is stored as a freeform note.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Optional short key for the preference (e.g. default_llm, main_workflow)" },
        value: { type: "string", description: "What to remember (the preference or fact)" },
      },
      required: ["value"],
    },
  },
  {
    name: "get_assistant_setting",
    description: "Get an assistant setting value. Supported key: recentSummariesCount (how many recent conversation summaries are included in context, 1–10). Use when the user asks what the current setting is.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", enum: ["recentSummariesCount"], description: "Setting key" },
      },
      required: ["key"],
    },
  },
  {
    name: "set_assistant_setting",
    description: "Update an assistant setting. Use when the user asks to change how many recent conversation summaries are used (e.g. 'use 5 recent summaries' or 'set summary count to 3'). recentSummariesCount: 1–10; default is 3. Lower = less context, faster; higher = more history from past chats.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", enum: ["recentSummariesCount"], description: "Setting key" },
        value: { type: "number", description: "Value (for recentSummariesCount: integer 1–10)" },
      },
      required: ["key", "value"],
    },
  },
];
