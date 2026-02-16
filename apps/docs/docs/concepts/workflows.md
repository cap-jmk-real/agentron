# Workflows

## Definition

A **workflow** is a graph of **agents** connected by **edges**. It orchestrates multiple agents and runs them in sequence or in loops.

## Workflow Structure

- **nodes** — Each node is typically an agent node: `{ id, type: "agent", config: { agentId } }`
- **edges** — `{ id, from: nodeId, to: nodeId }` define execution order
- **maxRounds** — When set with edges, execution follows the graph and stops after this many full cycles (prevents infinite loops)
- **branches** (optional) — Array of **disconnected graphs**, each with its own `nodes`, `edges`, `maxRounds`, **executionMode**, and optional **schedule**. Branches run in parallel; each can be one-time, interval, or continuous (see [Disconnected graphs and mixed execution](#disconnected-graphs-and-mixed-execution)).

## Execution Modes

Each workflow (and each **branch**) has an execution mode. You can mix modes across branches: some run once, some on an interval, some continuously.

| Mode | Description |
|------|-------------|
| **one_time** | Run only when explicitly triggered (e.g. `execute_workflow` or Run button). Never auto-scheduled. |
| **interval** | Run on a fixed schedule: every N seconds, or daily/weekly (e.g. `schedule: "60"` or `"daily@09:00"`). |
| **continuous** | Run repeatedly: when one run completes, the next run starts after an optional delay. No fixed clock; good for “run as long as possible” or daemon-style agents. Optional `schedule` (seconds) = delay between runs; otherwise a default delay is used. |

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

## Disconnected graphs and mixed execution

A workflow can define multiple **branches** (disconnected graphs). Each branch has its own:

- **Graph** — `nodes`, `edges`, `maxRounds`
- **Execution mode** — `one_time`, `interval`, or `continuous`
- **Schedule** (for interval: required; for continuous: optional delay between runs)

Branches run **in parallel** and **independently**. You can mix:

- **One-time** branches — Run only when you call `execute_workflow` with that `branchId` (or from the UI). Never auto-scheduled.
- **Interval** branches — Run on a fixed schedule (every N seconds, or daily/weekly). Require `schedule`.
- **Continuous** branches — Run over and over: when a run completes, the next run starts after a delay (optional `schedule` in seconds, or a default). No fixed clock; useful for agents that should “keep running” as long as the system is up.

The main workflow `nodes`/`edges` (without branches) are used for one-time or legacy runs when you don’t pass a branch.

## Schedules (interval and continuous)

- **Interval (fixed schedule)** — `schedule` = number of seconds (e.g. `"60"`) or calendar:
  - **Daily** — `"daily@HH:mm"` (e.g. `"daily@09:00"`).
  - **Weekly** — `"weekly@d1,d2,..."` where days are 0–6 (Sunday = 0), e.g. `"weekly@1,3,5"` for Mon/Wed/Fri.
- **Continuous (re-run after each run)** — `schedule` optional. If set to seconds (e.g. `"5"`), that’s the delay in seconds between runs; otherwise a default delay is used. Runs are chained: complete → wait → start next.

## Runs (Executions)

- Each workflow run creates an **execution** (run) with `targetType: "workflow"`, `targetId: workflowId`, and optionally `targetBranchId` when a branch was run.
- Use `list_runs` to see recent runs
- Use `get_run(id)` to inspect status, output, trail (per-agent input/output), and error

## Suggested User Actions

When a user wants to:
- **"Create a workflow with two agents"** — Create both agents with `create_agent`, then `create_workflow`, then `update_workflow` with nodes, edges, maxRounds.
- **"Fix a failed workflow"** — Use `get_run(runId)` or `list_runs` + `get_run` to diagnose. Then use `get_workflow`, `get_agent` to inspect configuration. Apply fixes with `update_workflow` or `update_agent`.
- **"Add an agent to my workflow"** — Use `get_workflow(id)`, then `update_workflow` with new node and edges.
- **"What went wrong with my run?"** — Use `get_run(id)` to see output, trail, and error.
