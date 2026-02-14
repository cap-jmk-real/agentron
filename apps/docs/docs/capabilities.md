# Capabilities

Agentron provides **local AI agent orchestration**, **workflow automation**, and **multi-agent** design in a single, self-hosted platform. Below is the feature matrix and what users can do.

## Feature Matrix

| Feature | Description | Primary Actions |
|---------|-------------|-----------------|
| **Agents** | Create, edit, delete node and code agents | create_agent, update_agent, delete_agent, get_agent |
| **Workflows** | Multi-agent orchestration in graphs | create_workflow, update_workflow, add_workflow_edges, get_workflow |
| **Tools** | Native, HTTP, MCP tools | create_tool, update_tool, list_tools, get_tool |
| **Runs** | Execute workflows/agents, inspect results | list_runs, get_run |
| **LLM Providers** | Configure OpenAI, Anthropic, Ollama, etc. | list_llm_providers (config via Settings) |
| **Agentron (Chat)** | Natural-language chat that creates/edits agents, workflows, tools via tool calls | Built-in; see [Agentron (Chat)](/concepts/assistant) |
| **Sandboxes** | Podman containers for code execution ([Installing Podman](/podman-install)) | create_sandbox, execute_code |
| **Custom Functions** | JavaScript/Python/TypeScript as tools | create_custom_function |
| **Knowledge / RAG** | Document ingestion and retrieval | UI-based; agents can use RAG collections |
| **Feedback** | Rate agent outputs for learning | UI-based; stored for prompt refinement |
| **Files** | Upload context files | list_files |
| **Remote Servers** | SSH tunnel to remote LLMs (e.g. Ollama) | test_remote_connection, save_remote_server |

## What Users Can Do

- **Design agents** — Node graphs with LLM and tool nodes, or code-based agents
- **Build workflows** — Connect agents, set max rounds, run multi-agent conversations
- **Add tools** — HTTP APIs, MCP servers, or custom code
- **Run and debug** — Execute workflows, inspect run output and errors
- **Chat with Agentron** — Use the **Chat** page for natural-language commands; the assistant creates/edits agents, workflows, and tools via tool calls. Configure prompt and context in chat settings; rate replies to improve behavior (see [Agentron (Chat)](/concepts/assistant)).
- **Rate and improve** — Feedback on assistant responses; optional prompt refinement

## Limits and Constraints

- **Node agents** require `llmConfigId` when using an LLM node
- **Standard tools** (std-*) can only update inputSchema/outputSchema
- **Workflows** need `maxRounds` when using looping edges to avoid infinite runs
- **Diagnose before fix** — Always use get_run, get_workflow, get_agent, get_tool before applying updates
