import type { AssistantToolDef } from "./types";

export const CONVERSATION_TOOLS: AssistantToolDef[] = [
  {
    name: "ask_user",
    description:
      "Ask the user for information or confirmation. REQUIRED: 'question' (string). When offering choices, pass 'options': 2–4 plain string labels for this question only. For multiple topics (e.g. content types, run frequency, vault usage): ask one topic per turn — call ask_user with that topic's question and that topic's options only; after the user replies, ask the next topic; repeat until all are answered, then create_agent/create_workflow with the collected inputs. Do NOT list all topic titles as one set of options. Same response: only ask_user + short message when waiting for input; no create_* or execute_workflow until you have all required answers. Wait for reply.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Clear question for this turn only (e.g. 'Which content types should we extract?' or 'Which LLM should I use?'). One topic per call when you need multiple answers." },
        options: { type: "array", items: { type: "string" }, description: "2–4 plain string labels for this question only (e.g. ['Headlines & job titles', 'Skills & About', 'All of the above'] for content types, or ['Run it now', 'Modify agent'] for next steps)." },
        reason: { type: "string", description: "Optional one-line reason (e.g. 'Need to pick LLM before creating agents')" },
        stepIndex: { type: "number", description: "Optional 1-based step number when asking multiple questions in sequence (e.g. 1 for first question)." },
        stepTotal: { type: "number", description: "Optional total number of steps when asking multiple questions (e.g. 4 for 'Step 1 of 4')." },
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
      "Format response for display. REQUIRED after create_agent or create_workflow: call with summary and needsInput. When you need multiple answers (e.g. content types, frequency, vault, format), do NOT put all topics in one block; instead ask one topic at a time via ask_user (question + that topic's options), then the next topic after the user replies. For a single next-step choice call ask_user in the same response (e.g. 'Run it now', 'Modify agent', 'Cancel'). Summary/needsInput: markdown with ## headings and 1. 2. 3. lists (no placeholders).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Main body: what you did, current status, context. Use markdown: ## or ### for headings, **bold** for emphasis, numbered lists as 1. 2. 3. on separate lines (proper numbering so the UI renders correctly). Shown first." },
        needsInput: { type: "string", description: "What the user must provide to proceed. Use markdown; keep concise. Shown in a highlighted block at the end." },
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
