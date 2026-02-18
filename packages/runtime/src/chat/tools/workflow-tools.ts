import type { AssistantToolDef } from "./types";

export const WORKFLOW_TOOLS: AssistantToolDef[] = [
  {
    name: "list_workflows",
    description: "List all workflows",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancel_run",
    description: "Cancel a workflow run that is waiting for user input. Use when the user says they want to stop, cancel, or abort the run.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID (from runWaitingContext)" },
      },
      required: ["runId"],
    },
  },
  {
    name: "respond_to_run",
    description: "Send the user's response to a workflow run that is waiting for user input. Use when the user is directly answering the run's question (e.g. selecting an option, providing requested data). Set 'response' to the **exact** text the user sent (full option label or their typed reply) — never a number or abbreviation. The run will resume with this response. Do NOT use when the user wants to stop the run, modify agents, or do something else.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID (from runWaitingContext)" },
        response: { type: "string", description: "The exact user message (full option label or typed text); never use '1', '2', or similar — pass the full text." },
      },
      required: ["runId", "response"],
    },
  },
  {
    name: "get_run",
    description: "Get a run/execution by ID. Returns status, output (with output.output and output.trail), error. Use to inspect what agents actually said and did (trail = per-step input/output). Call after execute_workflow when you need to re-read a run, or when the user refers to a specific run.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Run/execution ID (returned by execute_workflow)" } },
      required: ["id"],
    },
  },
  {
    name: "get_run_messages",
    description: "Get the workflow/run message log for a run (persisted agent and user messages). Use to see what has been said in the workflow so far (e.g. when a run is waiting for input or when the user asks what happened in a run). Returns ordered messages (role, content, nodeId, agentId, createdAt).",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run/execution ID" },
        limit: { type: "number", description: "Optional max number of messages to return (default 50, max 100)" },
      },
      required: ["runId"],
    },
  },
  {
    name: "get_run_for_improvement",
    description: "Load a run with bounded context for improving an agent: returns run metadata, trail summary (one line per step), and recent errors from run_logs. Use when improving from a failed or incomplete run (e.g. improvement workflow). First call with runId only; only pass includeFullLogs: true if the summary is insufficient to diagnose or fix the failure.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run/execution ID to load for improvement" },
        includeFullLogs: { type: "boolean", description: "If true, return full trail and run_logs. Default false. Only set true when the bounded summary is insufficient." },
      },
      required: ["runId"],
    },
  },
  {
    name: "get_feedback_for_scope",
    description: "List recent feedback for a target (agent or workflow) so you can improve from past user ratings. Returns short rows (notes, input/output summaries) for the targetId. Use label to filter by good/bad feedback, and limit to cap the number of rows (default 20, max 50).",
    parameters: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Target id (agent or workflow) whose feedback you want to load" },
        label: { type: "string", description: "Optional label to filter by (e.g. good, bad)" },
        limit: { type: "number", description: "Optional max number of rows (default 20, max 50)" },
      },
      required: ["targetId"],
    },
  },
  {
    name: "get_workflow",
    description: "Get a workflow by ID including its nodes, edges, and optional branches. Branches are disconnected graphs with their own schedule (interval, daily@HH:mm, weekly@0,1,2). Use when you need to read the current workflow graph or branches before updating.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Workflow ID" } },
      required: ["id"],
    },
  },
  {
    name: "add_workflow_edges",
    description: "Add one or more edges (and optionally new nodes) to an existing workflow without replacing the existing graph. Use this to connect existing agent nodes or add a new agent and connect it. For new nodes: parameters.agentId MUST be the exact UUID from create_agent, never placeholders. When adding edges that create a loop, pass maxRounds (e.g. 4 or 10) so execution does not run forever.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID" },
        edges: { type: "array", description: "Canvas format: [{ id, source: nodeId, target: nodeId }]" },
        nodes: { type: "array", description: "Optional new nodes: [{ id, type: 'agent', position: [x,y], parameters: { agentId: '<uuid-from-create_agent>' } }]" },
        maxRounds: { type: "number", description: "When edges create a loop: number of full cycles. One cycle = each agent in the loop runs once. E.g. 2-agent chat '3 rounds each' → maxRounds: 3 (3 cycles = 6 steps). Persisted." },
        turnInstruction: { type: "string", description: "Optional instruction for each agent turn (e.g. 'Reply directly to what the partner just said.') to get a real back-and-forth. Persisted." },
      },
      required: ["id", "edges"],
    },
  },
  {
    name: "create_workflow",
    description:
      [
        "Create a new workflow and save it to the database. The workflow appears in the studio sidebar under Workflows.",
        "",
        "MANDATORY SAME-TURN WIRING:",
        "When you create both agents and a workflow in the same turn, you MUST call update_workflow in the SAME turn (in the same tool_call batch, after create_workflow and create_agent return) to attach agent nodes, edges, and maxRounds. A workflow with no nodes/edges runs no agents and is useless. Never defer wiring to a \"next message\" or \"next response\" — you already have the workflow id and agent ids from the same turn.",
        "",
        "Workflow nodes are agent-only: pass only nodes with type 'agent'. Do not add type 'tool' to the workflow; tools are attached to agents via toolIds. For a single agent that uses tools, pass ONE node (that agent) and NO edges.",
        "Multi‑agent chat:",
        "After create_workflow and create_agent(s), call update_workflow with: nodes = one { id, type: 'agent', position, parameters: { agentId: '<exact-uuid>' } } per agent; edges = e.g. [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n1' }] for a loop; maxRounds = number of full cycles (one cycle = each agent speaks once). For '3 rounds each' in a 2-agent chat use maxRounds: 3 (6 steps total). For longer runs use e.g. 6–10.",
        "ALWAYS set maxRounds when edges form a loop so execution does not run forever.",
      ].join(" "),
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        executionMode: { type: "string", enum: ["one_time", "continuous", "interval"] },
      },
      required: ["name"],
    },
  },
  {
    name: "update_workflow",
    description:
      [
        "Update an existing workflow. REQUIRED when you have just created a workflow and agents in the same turn: call this in the SAME turn with nodes, edges, and maxRounds so the workflow actually runs agents.",
        "",
        "REQUIRED: id (workflow UUID from create_workflow).",
        "",
        "Nodes: array of { id (e.g. 'n1'), type: 'agent', position: [x,y], parameters: { agentId: '<exact-agent-uuid>' } }. Each node MUST be type 'agent' with parameters.agentId. Do NOT pass nodes with type 'tool'; the runtime does not support workflow-level tool nodes. Tools are configured on the agent (toolIds), not as workflow nodes.",
        "Edges: array of { id, source: nodeId, target: nodeId } (e.g. n1→n2 and n2→n1 for a two-agent chat loop). For a single agent, use no edges (empty array).",
        "maxRounds: REQUIRED when edges form a loop. Number of full cycles (one cycle = each agent runs once). For 2-agent chat, '3 rounds each' means maxRounds: 3 (6 steps). Use 6–10 only for longer conversations.",
        "",
        "Example (two-agent chat, 3 rounds each = 6 steps):",
        '{\"id\": \"<workflow-id>\", \"nodes\": [{\"id\": \"n1\", \"type\": \"agent\", \"position\": [0,0], \"parameters\": {\"agentId\": \"<uuid-from-create_agent-1>\"}}, {\"id\": \"n2\", \"type\": \"agent\", \"position\": [200,0], \"parameters\": {\"agentId\": \"<uuid-from-create_agent-2>\"}}], \"edges\": [{\"id\": \"e1\", \"source\": \"n1\", \"target\": \"n2\"}, {\"id\": \"e2\", \"source\": \"n2\", \"target\": \"n1\"}], \"maxRounds\": 3}.',
      ].join(" "),
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID (from create_workflow result)" },
        name: { type: "string" },
        executionMode: { type: "string", enum: ["one_time", "continuous", "interval"] },
        maxRounds: { type: "number", description: "REQUIRED when edges form a loop. Number of full cycles (one cycle = each agent speaks once). E.g. 2-agent '3 rounds each' → maxRounds: 3." },
        turnInstruction: { type: "string", description: "Optional instruction shown at the start of each agent turn. Omit to leave unset." },
        schedule: { type: "string", description: "Optional top-level schedule: interval seconds (e.g. '60'), daily@HH:mm, or weekly@0,1,2. Used when workflow has no branches." },
        nodes: { type: "array", description: "Each item: { id, type: 'agent', position: [x,y], parameters: { agentId: '<uuid-from-create_agent>' } }. Only agent nodes; do not add type 'tool' — tools are on the agent via toolIds." },
        edges: { type: "array", description: "Each item: { id, source: nodeId, target: nodeId }" },
        branches: {
          type: "array",
          description: "Optional array of disconnected graphs. Each branch: { id, name?, nodes, edges, maxRounds?, schedule?, executionMode? }. executionMode: one_time = run only when user triggers; interval = fixed schedule (schedule required: seconds, daily@HH:mm, weekly@0,1,2); continuous = re-run after each run completes (schedule optional = delay in seconds between runs). Branches run in parallel; mix modes freely.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_workflow",
    description: "Delete a workflow by ID. Use when the user asks to delete or remove a workflow. Get workflow ids from list_workflows.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Workflow ID to delete" } },
      required: ["id"],
    },
  },
  {
    name: "execute_workflow",
    description: "Run a workflow so its agents execute and produce output. Call this when the user says 'Run it now', 'Execute', 'Run the workflow', or selects that option from your format_response. Get the workflow id from list_workflows (use the only one, or the one you just created). Call after create_workflow and update_workflow when the user wants to run. Returns run id, status, and output (output.output = final text, output.trail = array of { nodeId, agentName, round, input, output } per step). You MUST inspect output.trail to see what the agents actually said; if it does not match the user's goal, use update_agent or update_workflow and call execute_workflow again. Do at most 2–3 improvement rounds, then report to the user.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID to run (from create_workflow or get_workflow)" },
        branchId: { type: "string", description: "Optional. When workflow has branches, run only this branch's graph. Use branch id from get_workflow.branches[].id." },
      },
      required: ["id"],
    },
  },
];
