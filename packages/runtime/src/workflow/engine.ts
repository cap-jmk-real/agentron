import type { Workflow, WorkflowExecutionStep } from "@agentron-studio/core";
import { SharedContextManager } from "../agent/context";

export type WorkflowNodeHandler = (
  nodeId: string,
  config: Record<string, unknown> | undefined,
  sharedContext: SharedContextManager
) => Promise<unknown>;

/** Simple leveled DAG representation for workflows: each inner array is one level. */
export type WorkflowDAGLevels = string[][];

function isParallelStep(step: WorkflowExecutionStep): step is { parallel: string[] } {
  return typeof step === "object" && step !== null && Array.isArray((step as { parallel: string[] }).parallel);
}

function getStepNodeIds(step: WorkflowExecutionStep): string[] {
  if (isParallelStep(step)) return step.parallel;
  return [step];
}

/**
 * Converts an explicit execution order (mirroring heap's priorityOrder) into
 * leveled DAG form. Validates node ids against workflow.nodes and strips unknowns.
 */
export function executionOrderToLevels(
  executionOrder: WorkflowExecutionStep[],
  workflow: Workflow
): WorkflowDAGLevels {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const levels: WorkflowDAGLevels = [];
  for (const step of executionOrder) {
    const ids = getStepNodeIds(step).filter((id) => nodeIdSet.has(id));
    if (ids.length > 0) levels.push(ids);
  }
  return levels;
}

/**
 * Builds a leveled DAG from the workflow. When executionOrder is present and non-empty,
 * uses it (with parallel groupings); otherwise falls back to node array order (one node per level).
 */
export function buildWorkflowDAGFromNodes(workflow: Workflow): WorkflowDAGLevels {
  const order = workflow.executionOrder;
  if (Array.isArray(order) && order.length > 0) {
    return executionOrderToLevels(order, workflow);
  }
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  return nodes.map((n) => [n.id]);
}

/**
 * Runs workflow nodes in leveled DAG form: all nodes in a level run in parallel,
 * levels run sequentially. For now buildWorkflowDAGFromNodes produces one node
 * per level, so behavior matches the previous linear execution.
 */
export async function runWorkflowDAGLevels(
  levels: WorkflowDAGLevels,
  workflow: Workflow,
  handlers: Record<string, WorkflowNodeHandler>,
  initialContext?: Record<string, unknown>
): Promise<{ output: unknown; context: Record<string, unknown> }> {
  const sharedContext = new SharedContextManager(initialContext);
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  let lastOutput: unknown = undefined;

  for (const level of levels) {
    const results = await Promise.all(
      level.map(async (nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) return undefined;
        const handler = handlers[node.type];
        if (!handler) throw new Error(`No handler for workflow node type ${node.type}`);
        const nodeParams = node as { parameters?: Record<string, unknown>; config?: Record<string, unknown> };
        const config = nodeParams.parameters ?? nodeParams.config ?? {};
        const output = await handler(node.id, config, sharedContext);
        sharedContext.set(`__output_${node.id}`, output);
        return output;
      })
    );

    // Track the last non-undefined output across the DAG.
    for (const r of results) {
      if (r !== undefined) {
        lastOutput = r;
      }
    }
  }

  return { output: lastOutput, context: sharedContext.snapshot() };
}

export class WorkflowEngine {
  async execute(
    workflow: Workflow,
    handlers: Record<string, WorkflowNodeHandler>,
    initialContext?: Record<string, unknown>
  ): Promise<{ output: unknown; context: Record<string, unknown> }> {
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const edges = Array.isArray(workflow.edges) ? workflow.edges : [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const maxRounds = workflow.maxRounds != null && workflow.maxRounds > 0 ? workflow.maxRounds : null;
    const hasEdges = edges.length > 0;

    if (hasEdges && maxRounds != null) {
      const sharedContext = new SharedContextManager(initialContext);

      // Edge-based execution: follow edges in a cycle for at most maxRounds full rounds.
      // One round = one full cycle (each node in the loop runs once). E.g. 2-agent loop with maxRounds 3 = 6 steps (3 per agent).
      const nextMap = new Map<string, string>();
      for (const e of edges) {
        const edge = e as { source?: string; target?: string; from?: string; to?: string };
        const from = edge.source ?? edge.from ?? "";
        const to = edge.target ?? edge.to ?? "";
        if (from && to && !nextMap.has(from)) nextMap.set(from, to);
      }
      const startNodeId = nodes[0]?.id;
      if (!startNodeId) return { output: undefined, context: sharedContext.snapshot() };
      let lastOutput: unknown = undefined;
      let currentId: string | undefined = startNodeId;
      for (let round = 0; round < maxRounds; round++) {
        sharedContext.set("__round", round);
        do {
          const node = nodeMap.get(currentId!);
          if (!node) break;
          const handler = handlers[node.type];
          if (!handler) throw new Error(`No handler for workflow node type ${node.type}`);
          const nodeParams = node as { parameters?: Record<string, unknown>; config?: Record<string, unknown> };
          const config = nodeParams.parameters ?? nodeParams.config ?? {};
          lastOutput = await handler(node.id, config, sharedContext);
          sharedContext.set(`__output_${node.id}`, lastOutput);
          currentId = nextMap.get(node.id);
        } while (currentId && currentId !== startNodeId);
        if (!currentId) break;
        currentId = startNodeId;
      }
      return { output: lastOutput, context: sharedContext.snapshot() };
    }

    // Linear execution: run nodes as a leveled DAG (one node per level for now).
    const levels = buildWorkflowDAGFromNodes(workflow);
    return runWorkflowDAGLevels(levels, workflow, handlers, initialContext);
  }
}
