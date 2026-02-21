/**
 * Programmatic DAG construction from heap route (priorityOrder).
 * No LLM — purely deterministic from the router output and registry.
 */

import type { HeapStep } from "./types";
import type { SpecialistRegistry } from "./registry";
import type { PlannerOutput } from "./types";

function isParallelStep(step: HeapStep): step is { parallel: string[] } {
  return (
    typeof step === "object" &&
    step !== null &&
    Array.isArray((step as { parallel: string[] }).parallel)
  );
}

function getStepIds(step: HeapStep): string[] {
  if (isParallelStep(step)) return step.parallel;
  return [step];
}

/** True if specialist id is agent (agent or agent__*). */
function isAgentId(id: string): boolean {
  return id === "agent" || id.startsWith("agent__");
}

/** True if specialist id is workflow (workflow or workflow__*). */
function isWorkflowId(id: string): boolean {
  return id === "workflow" || id.startsWith("workflow__");
}

/** True if specialist id is improve_agents_workflows (workflow-agent improver; cannot create agents/workflows). */
export function isImproveAgentsWorkflowsId(id: string): boolean {
  return id === "improve_agents_workflows" || id.startsWith("improve_agents_workflows__");
}

/**
 * Returns true when the plan implies creating both an agent and a workflow (so the workflow specialist needs the agent id from Previous steps).
 */
export function planImpliesCreateAgentAndWorkflow(plan: PlannerOutput | null): boolean {
  if (!plan) return false;
  const actions = plan.extractedContext?.requestedActions;
  if (Array.isArray(actions)) {
    const hasWorkflow = actions.some(
      (a) =>
        typeof a === "string" && (a.includes("workflow") || a.includes("add_agent_to_workflow"))
    );
    const hasAgent = actions.some(
      (a) => typeof a === "string" && (a.includes("create_agent") || a === "add_agent_to_workflow")
    );
    if (hasWorkflow && hasAgent) return true;
  }
  const iAgent = plan.instructionsForAgent ?? "";
  const iWorkflow = plan.instructionsForWorkflow ?? "";
  if (iAgent.length > 0 && iWorkflow.length > 0) {
    const agentCreate = /create\s+(?:an?\s+)?agent/i.test(iAgent);
    const workflowCreate = /create\s+(?:a\s+)?(?:new\s+)?workflow/i.test(iWorkflow);
    if (agentCreate && workflowCreate) return true;
  }
  return false;
}

/**
 * Reorders priorityOrder so all agent steps run before all workflow steps (other steps keep relative order).
 * Used when the plan implies create-agent + create-workflow so the workflow specialist sees [Created agent id: ...].
 */
export function reorderAgentBeforeWorkflow(priorityOrder: HeapStep[]): HeapStep[] {
  const levels: string[][] = [];
  for (const step of priorityOrder) {
    const ids = getStepIds(step);
    if (ids.length === 0) continue;
    levels.push(ids);
  }
  const firstWorkflow = levels.findIndex((l) => l.some(isWorkflowId));
  const lastAgentIdx = levels
    .map((l, i) => (l.some(isAgentId) ? i : -1))
    .filter((i) => i >= 0)
    .pop();
  const lastAgent = lastAgentIdx ?? -1;
  if (firstWorkflow === -1 || lastAgent === -1) return priorityOrder;
  if (firstWorkflow >= lastAgent) return priorityOrder;

  const before = levels.slice(0, firstWorkflow).filter((l) => !l.some(isAgentId));
  const agentLevels = levels.filter((l) => l.some(isAgentId) && !l.some(isWorkflowId));
  const after = levels.slice(firstWorkflow).filter((l) => !l.some(isAgentId));
  const reordered = [...before, ...agentLevels, ...after];
  return reordered.map((ids) => (ids.length === 1 ? ids[0] : { parallel: ids }));
}

/**
 * Reorders priorityOrder so all agent and workflow steps run before any improve_agents_workflows step.
 * Used when the plan implies create-agent + create-workflow so creation happens before the workflow-agent improver runs.
 * Preserves relative order within agent, workflow, improve_agents_workflows, and other groups.
 */
export function reorderAgentAndWorkflowBeforeImproveAgentsWorkflows(
  priorityOrder: HeapStep[]
): HeapStep[] {
  const levels: string[][] = [];
  for (const step of priorityOrder) {
    const ids = getStepIds(step);
    if (ids.length === 0) continue;
    levels.push(ids);
  }
  const agentLevels = levels.filter((l) => l.some(isAgentId) && !l.some(isWorkflowId));
  const workflowLevels = levels.filter((l) => l.some(isWorkflowId));
  const improveLevels = levels.filter(
    (l) => l.some(isImproveAgentsWorkflowsId) && !l.some(isAgentId) && !l.some(isWorkflowId)
  );
  const otherLevels = levels.filter(
    (l) => !l.some(isAgentId) && !l.some(isWorkflowId) && !l.some(isImproveAgentsWorkflowsId)
  );
  const reordered = [...agentLevels, ...workflowLevels, ...improveLevels, ...otherLevels];
  if (reordered.length !== levels.length) return priorityOrder;
  return reordered.map((ids) => (ids.length === 1 ? ids[0] : { parallel: ids }));
}

function validateIds(ids: string[], registry: SpecialistRegistry): string[] {
  return ids.filter((id) => id in registry.specialists);
}

/**
 * Builds a DAG from priorityOrder: each step becomes one level; parallel steps become multiple nodes at that level.
 * Validates all specialist ids against the registry; strips unknown ids.
 */
export function buildHeapDAG(
  priorityOrder: HeapStep[],
  registry: SpecialistRegistry
): { levels: string[][] } {
  const levels: string[][] = [];
  for (const step of priorityOrder) {
    const ids = getStepIds(step);
    const valid = validateIds(ids, registry);
    if (valid.length === 0) continue;
    levels.push(valid);
  }
  return { levels };
}
