# Agents

## Definition

An **agent** is an executable unit that processes input and produces output. AgentOS Studio supports two agent kinds:

| Kind | Description |
|------|-------------|
| **node** | Graph-based. Nodes are LLM, decision, tool, context_read, context_write, input, output. Execution follows edges. |
| **code** | Custom script (JavaScript, Python, TypeScript) run in a sandbox. |

## Node Agents

Node agents run a **graph** of nodes connected by edges.

### Decision Layer

The **decision layer** lets the agent decide per request whether to call a tool or respond directly. Configure it by:

- **LLM node with toolIds**: Add `toolIds` to the agent definition; the LLM receives tool definitions and may return tool calls.
- **Decision node**: A dedicated node type with `llmConfigId`, `toolIds`, and `systemPrompt`. Each decision node can use a different LLM and tool set.

The agent can only decide on tools that are defined for it (agent-level `toolIds` or node-level `toolIds` for decision nodes).

### Node Types

| Type | Parameters | Purpose |
|------|------------|---------|
| **llm** | `systemPrompt` (required), `llmConfigId` (optional) | Calls the LLM. Optional per-node LLM config. |
| **decision** | `systemPrompt`, `llmConfigId` (required), `toolIds` | Decision layer: LLM decides whether to call tools or respond. Per-node LLM and tools. |
| **tool** | `toolId` | Calls a tool by ID. |
| **context_read** | `key` | Reads from shared context. |
| **context_write** | `key` | Writes to shared context. |
| **input** | `transform.expression` | Entry point; optional transform (e.g. `{{ $input }}`). |
| **output** | `transform.expression` | Exit point; optional transform. |

### Per-Node LLM Config

LLM and decision nodes can specify `llmConfigId` to use a different LLM than the agent default. When omitted, the agent's `defaultLlmConfigId` is used, or the first available config.

### Graph Structure (Canvas Format)

```json
{
  "graph": {
    "nodes": [
      { "id": "n1", "type": "llm", "position": [100, 100], "parameters": { "systemPrompt": "You are a helpful assistant.", "llmConfigId": "cfg-1" } },
      { "id": "n2", "type": "decision", "position": [100, 220], "parameters": { "systemPrompt": "Decide whether to use tools.", "llmConfigId": "cfg-1", "toolIds": ["std-weather"] } }
    ],
    "edges": [
      { "id": "e1", "source": "n1", "target": "n2" }
    ]
  },
  "defaultLlmConfigId": "cfg-1",
  "toolIds": ["std-weather"]
}
```

Execution flows along edges. The output of one node becomes input to the next.

## Required Fields for Node Agents

- **name** — Display name
- **description** — What the agent does
- **llmConfigId** / **defaultLlmConfigId** — ID from `list_llm_providers`. Required for agents that use LLM or decision nodes.
- **graphNodes** — At least one `llm` or `decision` node for AI responses
- **graphEdges** — Connect nodes (`source`, `target`)
- **toolIds** (optional) — Array of tool IDs for the decision layer (LLM node or decision nodes)

## Code Agents

Code agents execute custom source code in a sandbox. They have `source` and `entrypoint`.

## Suggested User Actions

When a user wants to:
- **"Create an agent"** — Use `list_llm_providers` first if LLM needed. Then `create_agent` with name, description, llmConfigId, graphNodes, graphEdges, toolIds.
- **"Fix an agent"** — Use `get_agent(id)` first to see current state, then `update_agent` with corrected fields.
- **"Populate agent settings"** — Use `get_agent`, `list_tools`, `list_llm_providers`, then `update_agent` with toolIds, llmConfigId, systemPrompt, description.
- **"Add tools to my agent"** — Use `list_tools` to get IDs, then `update_agent` with `toolIds` array.
- **"Delete an agent"** — Use `delete_agent(id)`.
