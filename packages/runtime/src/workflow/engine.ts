import type { Workflow } from "@agentron-studio/core";
import { SharedContextManager } from "../agent/context";

export type WorkflowNodeHandler = (
  nodeId: string,
  config: Record<string, unknown> | undefined,
  sharedContext: SharedContextManager
) => Promise<unknown>;

export class WorkflowEngine {
  async execute(
    workflow: Workflow,
    handlers: Record<string, WorkflowNodeHandler>,
    initialContext?: Record<string, unknown>
  ): Promise<{ output: unknown; context: Record<string, unknown> }> {
    const sharedContext = new SharedContextManager(initialContext);
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const edges = Array.isArray(workflow.edges) ? workflow.edges : [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const maxRounds = workflow.maxRounds != null && workflow.maxRounds > 0 ? workflow.maxRounds : null;
    const hasEdges = edges.length > 0;

    if (hasEdges && maxRounds != null) {
      // Edge-based execution: follow edges in a cycle for at most maxRounds full rounds
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

    // Linear execution: run nodes in array order (original behavior)
    let lastOutput: unknown = undefined;
    for (const node of nodes) {
      const handler = handlers[node.type];
      if (!handler) throw new Error(`No handler for workflow node type ${node.type}`);
      const nodeParams = node as { parameters?: Record<string, unknown>; config?: Record<string, unknown> };
      const config = nodeParams.parameters ?? nodeParams.config ?? {};
      lastOutput = await handler(node.id, config, sharedContext);
      sharedContext.set(`__output_${node.id}`, lastOutput);
    }
    return { output: lastOutput, context: sharedContext.snapshot() };
  }
}
