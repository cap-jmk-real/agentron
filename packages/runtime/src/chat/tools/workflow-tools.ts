import type { AssistantToolDef } from "./types";

export const WORKFLOW_TOOLS: AssistantToolDef[] = [
  {
    name: "list_workflows",
    description: "List all workflows",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_run",
    description: "Get a run/execution by ID. Returns status, output, trail (per-agent input/output), error. Use to diagnose failed runs before fixing workflows or agents. When the user says a workflow/run failed, call this with the run ID to understand what went wrong.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Run/execution ID" } },
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
    description: "Add one or more edges (and optionally new nodes) to an existing workflow without replacing the existing graph. Use this to connect existing agent nodes or add a new agent and connect it.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID" },
        edges: { type: "array", description: "Canvas format: [{ id, source: nodeId, target: nodeId }]" },
        nodes: { type: "array", description: "Optional new nodes: [{ id, type: 'agent', position: [x,y], parameters: { agentId } }]" },
      },
      required: ["id", "edges"],
    },
  },
  {
    name: "create_workflow",
    description: "Create a new workflow and save it to the database. The workflow will appear in the studio sidebar under Workflows. Use update_workflow afterward to add agent nodes and edges so the workflow actually runs agents.",
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
    description: "Update an existing workflow. REQUIRED: id (workflow UUID from create_workflow). Optional: name, executionMode, maxRounds, nodes, edges. Nodes: array of { id (e.g. 'n1'), type: 'agent', position: [x,y], parameters: { agentId: '<agent-uuid>' } } — agentId MUST be the UUID returned by create_agent for that agent, not inline prompts. Edges: array of { id (e.g. 'e1'), source: '<node-id>', target: '<node-id>' } where source/target are node ids from the nodes array. Call with valid JSON only, e.g. {\"name\": \"update_workflow\", \"arguments\": {\"id\": \"...\", \"nodes\": [...], \"edges\": [...], \"maxRounds\": 4}}.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID (from create_workflow result)" },
        name: { type: "string" },
        executionMode: { type: "string", enum: ["one_time", "continuous", "interval"] },
        maxRounds: { type: "number", description: "Max execution rounds (e.g. 4)" },
        nodes: { type: "array", description: "Each item: { id, type: 'agent', position: [x,y], parameters: { agentId: '<uuid-from-create_agent>' } }" },
        edges: { type: "array", description: "Each item: { id, source: nodeId, target: nodeId }" },
      },
      required: ["id"],
    },
  },
];
