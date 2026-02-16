import type { AssistantToolDef } from "./types";

export const CONVERSATION_TOOLS: AssistantToolDef[] = [
  {
    name: "ask_user",
    description:
      "Ask the user for information or confirmation before proceeding. Use when you need: a choice (e.g. which cities, which LLM when multiple), confirmation of a plan, or any missing detail you cannot infer. Call this with a clear, specific question. In the SAME response do NOT output any create_*, update_*, or execute_workflow tool calls — only ask_user and your short message. Wait for the user's reply before creating or updating resources.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Clear question to show the user (e.g. 'Which LLM should I use?' or 'Confirm: create 3 agents?')" },
        options: { type: "array", items: { type: "string" }, description: "Optional list of choices the user can click (e.g. ['OpenAI gpt-4', 'Ollama llama3'] or ['Yes', 'No']). Use when asking the user to pick one option." },
        reason: { type: "string", description: "Optional one-line reason (e.g. 'Need to pick LLM before creating agents')" },
      },
      required: ["question"],
    },
  },
  {
    name: "ask_credentials",
    description:
      "Ask the user for a secret (password, API key, token) that only they can provide. Use when a task requires credentials (e.g. API key for a new LLM provider, SSH password). The user will see a secure input and can optionally save the credential for future use. Call with a clear prompt and a stable credentialKey so saved credentials can be reused (e.g. 'openai_api_key', 'github_token'). In the SAME response do NOT output create_* or execute_workflow — only ask_credentials and a short message. Wait for the user to submit before proceeding.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Clear prompt for the user (e.g. 'Enter your OpenAI API key' or 'Enter the SSH password for user@host')" },
        credentialKey: { type: "string", description: "Stable key for this credential so it can be saved and reused (e.g. 'openai_api_key', 'github_token'). Use lowercase with underscores." },
      },
      required: ["question", "credentialKey"],
    },
  },
  {
    name: "format_response",
    description:
      "Format your response for clear display. REQUIRED after create_agent or create_workflow: you MUST call format_response with summary (what you did), needsInput (e.g. 'What would you like to do next?'), and options (clickable choices). Include 'Run it now' or 'Run workflow' when the created resource can be executed — e.g. options: ['Run it now', 'Modify agent', 'Not now']. The UI shows clickable options ONLY when you call format_response with the options array; plain text does not work. Also use format_response when the user needs to provide inputs (URLs, choices, credentials) before you can continue.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Main body: what you did, current status, context. Use markdown for readability: ## or ### headings for sections, **bold** for emphasis, - or 1. lists for options or steps. Shown first." },
        needsInput: { type: "string", description: "What the user must provide to proceed (URLs, choices, auth preference, filters, etc.). Shown in a highlighted block at the end." },
        options: { type: "array", items: { type: "string" }, description: "Optional clickable options the user can select (e.g. ['Run workflow X', 'Provide URLs', 'Use credentials'])" },
      },
      required: ["summary"],
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
