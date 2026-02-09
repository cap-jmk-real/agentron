# Workflows

## Definition

A **workflow** is a graph of **agents** connected by **edges**. It orchestrates multiple agents and runs them in sequence or in loops.

## Workflow Structure

- **nodes** — Each node is typically an agent node: `{ id, type: "agent", config: { agentId } }`
- **edges** — `{ id, from: nodeId, to: nodeId }` define execution order
- **maxRounds** — When set with edges, execution follows the graph and stops after this many full cycles (prevents infinite loops)

## Execution Modes

| Mode | Description |
|------|-------------|
| **one_time** | Run once. |
| **continuous** | Run continuously (schedule-based). |
| **interval** | Run on an interval. |

## How Execution Works

1. Workflow engine follows edges from node to node
2. Each agent node runs the agent with the previous output as input
3. Agent output is passed to the next node
4. For loops (e.g. A → B → A), execution repeats up to `maxRounds` full cycles

## Creating a Workflow

1. **create_workflow** — Creates an empty workflow with a name
2. **update_workflow** — Add `nodes` (agent nodes), `edges`, and `maxRounds`

Example: Two agents talking, max 10 rounds

```json
{
  "nodes": [
    { "id": "a1", "type": "agent", "config": { "agentId": "<agent-1-id>" } },
    { "id": "a2", "type": "agent", "config": { "agentId": "<agent-2-id>" } }
  ],
  "edges": [
    { "id": "e1", "from": "a1", "to": "a2" },
    { "id": "e2", "from": "a2", "to": "a1" }
  ],
  "maxRounds": 10
}
```

## Runs (Executions)

- Each workflow run creates an **execution** (run) with `targetType: "workflow"`, `targetId: workflowId`
- Use `list_runs` to see recent runs
- Use `get_run(id)` to inspect status, output, trail (per-agent input/output), and error

## Suggested User Actions

When a user wants to:
- **"Create a workflow with two agents"** — Create both agents with `create_agent`, then `create_workflow`, then `update_workflow` with nodes, edges, maxRounds.
- **"Fix a failed workflow"** — Use `get_run(runId)` or `list_runs` + `get_run` to diagnose. Then use `get_workflow`, `get_agent` to inspect configuration. Apply fixes with `update_workflow` or `update_agent`.
- **"Add an agent to my workflow"** — Use `get_workflow(id)`, then `update_workflow` with new node and edges.
- **"What went wrong with my run?"** — Use `get_run(id)` to see output, trail, and error.
