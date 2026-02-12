import type { AssistantToolDef } from "./types";

export const WORKFLOW_TOOLS: AssistantToolDef[] = [
  {
    name: "list_workflows",
    description: "List all workflows",
    parameters: { type: "object", properties: {}, required: [] },
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
    name: "get_workflow",
    description: "Get a workflow by ID including its nodes and edges. Use this when you need to read the current workflow graph before adding edges or updating it.",
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
        "Nodes: array of { id (e.g. 'n1'), type: 'agent', position: [x,y], parameters: { agentId: '<exact-agent-uuid>' } }. agentId MUST be the exact UUID returned by create_agent in this turn — no placeholders.",
        "Edges: array of { id, source: nodeId, target: nodeId } (e.g. n1→n2 and n2→n1 for a two-agent chat loop).",
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
        turnInstruction: { type: "string", description: "Optional instruction shown at the start of each agent turn (e.g. 'Reply directly to what the partner just said; do not monologue.') to make the conversation feel like a real back-and-forth. Omit to leave unset." },
        nodes: { type: "array", description: "Each item: { id, type: 'agent', position: [x,y], parameters: { agentId: '<uuid-from-create_agent>' } }" },
        edges: { type: "array", description: "Each item: { id, source: nodeId, target: nodeId }" },
      },
      required: ["id"],
    },
  },
  {
    name: "execute_workflow",
    description: "Run a workflow so its agents execute and produce output. Call after create_workflow and update_workflow when the user wants to run. Returns run id, status, and output (output.output = final text, output.trail = array of { nodeId, agentName, round, input, output } per step). You MUST inspect output.trail to see what the agents actually said; if it does not match the user's goal (e.g. agents should discuss weather but trail shows other topics), use update_agent (e.g. add toolIds like std-weather, tighten systemPrompt) and call execute_workflow again. Do at most 2–3 improvement rounds, then report to the user.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Workflow ID to run (from create_workflow or get_workflow)" } },
      required: ["id"],
    },
  },
];
