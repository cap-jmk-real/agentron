# Agentron

## Definition

**Agentron** is the built-in chat interface. It uses an LLM and a set of **tools** to create, edit, list, and manage agents, workflows, tools, sandboxes, and more — on behalf of the user.

## How It Works

1. User sends a message in the chat
2. Assistant receives the message plus **context**: UI location, RAG chunks, feedback from past runs, studio resources (agents, workflows, tools, LLM providers)
3. Assistant produces a response that may include **tool calls** in the format: `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`
4. System executes tool calls and feeds results back to the assistant
5. Assistant may produce more tool calls (multi-round) or a final answer

## Assistant Tools (Summary)

| Category | Tools |
|----------|-------|
| **Agents** | list_agents, get_agent, create_agent, update_agent, delete_agent |
| **Workflows** | list_workflows, get_workflow, create_workflow, update_workflow, add_workflow_edges |
| **Tools** | list_tools, get_tool, create_tool, update_tool |
| **LLM** | list_llm_providers |
| **Runs** | list_runs, get_run |
| **Other** | create_custom_function, create_sandbox, execute_code, list_files, answer_question, explain_software |
| **Remote** | list_remote_servers, test_remote_connection, save_remote_server |

## Routing Rules

- **"Create", "edit", "list", "delete"** studio resources → Use the corresponding resource tools (create_agent, update_workflow, etc.)
- **"Fix", "populate", "configure"** → Use get_* to diagnose first, then update_*
- **Creating agents with tools** → Include `toolIds` for the decision layer; agents can only decide on tools defined in `toolIds`.
- **General knowledge / coding questions** → Use `answer_question`
- **Questions about Agentron itself** → Use `explain_software`

## Customization

Users can:
- **Custom system prompt** — Override the default assistant prompt
- **Restore standard prompt** — Revert to the built-in prompt
- **Context selection** — Choose which agents, workflows, tools to include in the assistant's context
- **Improve from feedback** — Use rated conversations to suggest prompt improvements

## Dedicated Chat Page

The `/chat` page provides a full-screen Agentron with:
- Conversation list and ratings
- Settings panel for prompt and context configuration
