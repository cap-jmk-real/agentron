# Agentron (Chat)

## What is the chat?

**Agentron** is the built-in **chat assistant** in the app. You talk to it in natural language; it uses an LLM and a set of **tools** to create, edit, list, and manage agents, workflows, tools, sandboxes, and more on your behalf. You don’t have to click through every form — you can say things like “Create a workflow that runs my weather agent then my summarizer” and the assistant will call the right tools to do it.

## Where to find it

- **Dedicated chat page**: Open **Chat** in the sidebar (or go to `/chat`) for a full-screen chat with conversation history, ratings, and settings.
- **Elsewhere in the app**: The chat is available from the main navigation so you can ask for help or run actions from anywhere.

On the chat page you get:

- **Conversation list** — Previous chats; open one to continue or review.
- **Ratings** — Rate assistant replies (e.g. thumbs up/down) to improve future behavior.
- **Settings** — Customize the system prompt and choose which agents, workflows, and tools the assistant can see (context selection).

## How it works (under the hood)

1. **You send a message** in the chat input.
2. **The assistant receives** your message plus **context**: where you are in the UI, relevant RAG chunks (if any), feedback from past runs, and the studio resources you’ve allowed (agents, workflows, tools, LLM providers).
3. **The assistant can reply with tool calls** in a structured format, e.g. `<tool_call>{"name": "create_agent", "arguments": {...}}</tool_call>`.
4. **The system runs those tools** (e.g. creates an agent, updates a workflow) and sends the results back to the assistant.
5. **The assistant may do more tool calls** in the same turn or in follow-up turns, or it may answer you in plain text.

So the chat is not just Q&A — it can change your agents, workflows, and tools by calling the same APIs the UI uses.

## What the assistant can do (tools)

| Category | Tools |
|----------|-------|
| **Agents** | list_agents, get_agent, create_agent, update_agent, delete_agent |
| **Workflows** | list_workflows, get_workflow, create_workflow, update_workflow, add_workflow_edges |
| **Tools** | list_tools, get_tool, create_tool, update_tool |
| **LLM** | list_llm_providers |
| **Runs** | list_runs, get_run |
| **Reminders** | create_reminder, list_reminders, cancel_reminder |
| **Other** | create_custom_function, create_sandbox, execute_code, list_files, answer_question, explain_software |
| **Remote** | list_remote_servers, test_remote_connection, save_remote_server |

- **“Create”, “edit”, “list”, “delete”** studio resources → The assistant uses the matching tools (create_agent, update_workflow, etc.).
- **“Remind me in 20 minutes to …”, “remind me at 3pm”** → It uses `create_reminder` (message + `at` or `inMinutes`). The reminder appears in the same chat when it fires. Use `list_reminders` / `cancel_reminder` to manage reminders.
- **“Fix”, “configure”, “populate”** → It uses get_* first to see the current state, then update_*.
- **General or coding questions** → It uses `answer_question`.
- **Questions about Agentron** (e.g. “What is a workflow?”) → It uses `explain_software`.

## Customization

- **Custom system prompt** — Override the default instructions so the assistant behaves the way you want.
- **Restore standard prompt** — Revert to the built-in prompt.
- **Context selection** — Choose which agents, workflows, and tools are included in the assistant’s context so it only suggests or edits what you care about.
- **Improve from feedback** — Use conversation ratings so the system can suggest prompt improvements over time.

## Reminders

You can ask the assistant to set **one-shot reminders** (e.g. “Remind me in 20 minutes to call John” or “Remind me at 3pm to submit the report”). The assistant uses `create_reminder`; when the time comes, the reminder text is posted into the same chat. See [Reminders](../reminders.md) for details.

## Summary

The chat is your natural-language interface to the studio: describe what you want, and the assistant uses tools to create or change agents, workflows, and tools. Use the **Chat** page for full-screen use, history, ratings, and settings.
