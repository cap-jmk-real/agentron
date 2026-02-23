/**
 * Planner: builds prompt for the planner LLM and parses its output (plan with priorityOrder, refinedTask, extractedContext, instructionsFor*).
 */

import type { HeapStep } from "./types";
import type { PlannerOutput } from "./types";
import type { SpecialistRegistry } from "./registry";
import { getSpecialistOptions } from "./registry";
import { ROUTER_OPTIONS_CAP } from "./router";
import { planImpliesCreateAgentAndWorkflow } from "./heap-dag";

/** Retry instruction appended when planner returns empty or invalid. */
export const PLANNER_RETRY_INSTRUCTION = "\n\nOutput only a single JSON object, no other text.";

/**
 * Builds the planner prompt: user message + instruction to output a single JSON plan.
 * Shows at most ROUTER_OPTIONS_CAP specialists (and their option groups). Deeper exploration is via delegation, not full tree.
 * @param recentConversationContext - Optional short recent conversation (last 2–4 messages) for extractedContext and intent (e.g. "run the workflow we were just configuring").
 * @param runWaitingContext - When set, a run is waiting for user input; the user message may be a direct reply. Planner should route to workflow and set instructionsForWorkflow to call respond_to_run when appropriate.
 */
export function buildPlannerPrompt(
  userMessage: string,
  registry: SpecialistRegistry,
  recentConversationContext?: string,
  runWaitingContext?: string
): string {
  const ids = registry.topLevelIds.slice(0, ROUTER_OPTIONS_CAP);
  const specialistList = ids
    .map((id) => {
      const entry = registry.specialists[id];
      const desc = entry?.description ? ` — ${entry.description}` : "";
      return `- ${id}${desc}`;
    })
    .join("\n");

  const optionsList = getSpecialistOptions(registry, undefined)
    .filter((_o, i) => i < ROUTER_OPTIONS_CAP)
    .map((o) => {
      const groups = Object.entries(o.optionGroups)
        .map(([k, v]) => `${k}: ${v.label} (${v.toolIds.length} tools)`)
        .join("; ");
      return `${o.specialistId}: ${groups}`;
    })
    .join("\n");

  const recentBlock =
    recentConversationContext && recentConversationContext.trim()
      ? `
Recent conversation (use for extractedContext and user intent):
---
${recentConversationContext.trim()}
---

`
      : "";

  const runWaitingBlock =
    runWaitingContext && runWaitingContext.trim()
      ? `
Run waiting for user reply (user message may be a direct reply to this run):
---
${runWaitingContext.trim()}
---
When the user message looks like a direct reply (e.g. option number + URL, single option, short answer), set priorityOrder to include "workflow" first and set instructionsForWorkflow to: "Call respond_to_run with the runId from the context above and response set to the exact user message." If the user wants to cancel, set instructionsForWorkflow to call cancel_run with that runId instead.

`
      : "";

  return `You are a planner. The user message and available specialists are below.
${recentBlock}${runWaitingBlock}
Available specialists (use their ids in priorityOrder). Each is a first-level choice; "agent" and "workflow" have subspecialists (e.g. create vs run) chosen in a later step based on the task.
${specialistList}

Structured options (query heap by these groups; improver/planner use these instead of judging a full tool list):
${optionsList}

Output exactly one JSON object, no other text, in this form:
{
  "priorityOrder": [...],
  "refinedTask": "...",
  "extractedContext": { ... },
  "instructionsForGeneral": "...",
  "instructionsForAgent": "...",
  "instructionsForWorkflow": "...",
  "instructionsForImproveRun": "...",
  "instructionsForImproveHeap": "...",
  "instructionsForImproveAgentsWorkflows": "..."
}

Example for "Create a workflow with one agent that fetches example.com": {"priorityOrder": ["agent", "workflow", "general"], "refinedTask": "Create a workflow with one agent that fetches example.com and returns the page title.", ...}

Rules:
- priorityOrder: array of specialist ids from the list. Use "improve_run" when the user wants to suggest or preview improvements for the current run/session only (no DB writes). Use "improve_heap" when the user wants to add or change specialists or planner (heap registry). Use "improve_agents_workflows" when the user wants to persistently improve workflow agents or workflows from a run/feedback or design self-learning. improve_agents_workflows does not create agents or workflows; only updates existing ones. For "create new agent and workflow", do not put improve_agents_workflows first — put agent and workflow first (see next rule).
- CRITICAL — Order when creating both agent and workflow: When the user wants to create a workflow with one or more agents, or "create agent and workflow", or "workflow with an agent that...", you MUST put "agent" first, then "workflow", in priorityOrder. Example: ["agent", "workflow", "general"]. Never use ["workflow", "agent", ...] for create-both requests — the workflow step needs the agent id from the previous step. So: agent before workflow whenever both are needed for creation.
- CRITICAL — Order when adding a new tool for an agent: When the user wants to add a new tool, or fix an agent by adding a missing tool (e.g. conversation says the agent lacks a tool, or user says "add tool X", "fix the agent", "do 1" after being offered "Fix the agent"), you MUST put "tools" before "agent" in priorityOrder so the tool is created or registered first. Example: ["tools", "agent", "workflow", "general"]. Never put "agent" before "tools" when the task requires creating a tool that the agent will use — the agent specialist cannot use a tool that does not exist yet.
- When the user wants to create both an agent and a workflow and add the agent to the workflow (or run it), put "agent" and "workflow" before "improve_agents_workflows" in priorityOrder. The improve_agents_workflows specialist cannot create agents or workflows. Example: ["agent", "workflow", "general"] or ["agent", "workflow", "improve_agents_workflows", "general"], not ["improve_agents_workflows", "agent", "workflow", "general"] and not ["workflow", "agent", "general"].
- refinedTask: one short sentence.
- extractedContext: concrete values (savedSearchUrl, savedSearchId, filePaths, ids, runId, agentId). Preserve every URL and identifier from the user message and recent conversation in extractedContext (e.g. copy savedSearchUrl, savedSearchId, file paths verbatim). Use recent conversation to fill extractedContext and to infer intent (e.g. "run the workflow we were just configuring").
- When the user's intent is clear from recent conversation (e.g. "Run On Demand" or "run it" right after configuring or discussing a single workflow/agent), set extractedContext.workflowId or instructionsForWorkflow so the workflow specialist can list workflows and, if only one, run it with on_demand; if multiple and none clearly selected, then ask user to choose.
- Ask for workflowId/agentId/runId only when genuinely ambiguous (e.g. multiple workflows and no prior selection in this conversation).
- instructionsFor*: optional. instructionsForImproveRun = current run/session only. instructionsForImproveHeap = query heap, register_specialist or update_specialist. instructionsForImproveAgentsWorkflows = observe, decide (act_prompt/act_topology/act_training), act, evaluate; workflow-agent loop.
- When priorityOrder is ["agent", "workflow", ...] for a create-both task (workflow with one or more agents), set instructionsForAgent to: "In this turn you MUST call create_agent (with name, description, systemPrompt, graphNodes, and toolIds as needed). The workflow specialist runs next and needs the created agent id. Do not only list_agents or list_tools; create the agent now." Set instructionsForWorkflow to: "Use the agent id from [Created agent id: ...] in Previous steps for parameters.agentId on each workflow node. If Previous steps do not contain an agent id yet, list_agents and use the matching agent id."
- Simple question: When the user asks a simple factual or definitional question (e.g. "What is X?", "Explain Y", "What are canary thresholds?") and does NOT ask to create, edit, list, or run agents, workflows, or tools, treat it as a simple question. Then set priorityOrder to ["general"] only (no agent, workflow, or improve_*). Set refinedTask to a short task like "Answer the user's question" or the user's question. Set instructionsForGeneral to: "Call answer_question with the user's question. Then respond with a clear, concise answer. Do not create or modify agents or workflows. Do not call list_agents, create_workflow, or other resource tools." When it is NOT a simple question (user wants to create/edit/run resources), use the rules above and do not restrict to general only.
- CRITICAL — instructionsForGeneral when agent or workflow are in the route: When priorityOrder includes "agent" or "workflow" (e.g. create workflow, create agent, run workflow), do NOT set instructionsForGeneral to the simple-question restriction (answer_question only, "Do not create or modify agents or workflows"). Leave instructionsForGeneral empty or set it only to format/summarize guidance (e.g. "Summarize what was created and run; call format_response with options."). The general specialist will then report outcomes from previous steps instead of being told not to touch agents/workflows.

User message:
---
${userMessage}
---`;
}

/** Flattens priorityOrder to a list of specialist ids (parallel groups expanded). */
function flattenPriorityOrder(steps: HeapStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (typeof step === "string") ids.push(step);
    else if (step && Array.isArray(step.parallel)) ids.push(...step.parallel);
  }
  return ids;
}

/**
 * Parses planner LLM output into PlannerOutput. Returns null if invalid.
 */
export function parsePlanOutput(text: string): PlannerOutput | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const order = obj.priorityOrder;
    const task = obj.refinedTask;
    if (!Array.isArray(order)) return null;
    if (typeof task !== "string") return null;
    const priorityOrder: HeapStep[] = [];
    for (const item of order) {
      if (typeof item === "string") {
        priorityOrder.push(item);
      } else if (
        item &&
        typeof item === "object" &&
        Array.isArray((item as { parallel?: unknown }).parallel)
      ) {
        const arr = (item as { parallel: unknown[] }).parallel.filter(
          (x): x is string => typeof x === "string"
        );
        if (arr.length > 0) priorityOrder.push({ parallel: arr });
      }
    }
    const extractedContext =
      obj.extractedContext &&
      typeof obj.extractedContext === "object" &&
      obj.extractedContext !== null
        ? (obj.extractedContext as Record<string, unknown>)
        : undefined;
    const instructionsForGeneral =
      typeof obj.instructionsForGeneral === "string" ? obj.instructionsForGeneral : undefined;
    const instructionsForAgent =
      typeof obj.instructionsForAgent === "string" ? obj.instructionsForAgent : undefined;
    const instructionsForWorkflow =
      typeof obj.instructionsForWorkflow === "string" ? obj.instructionsForWorkflow : undefined;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const instructionsForImproveRun =
      str(obj.instructionsForImproveRun) ?? str(obj.instructionsForImprovementSession);
    const instructionsForImproveHeap =
      str(obj.instructionsForImproveHeap) ?? str(obj.instructionsForImprovementHeap);
    const instructionsForImproveAgentsWorkflows =
      str(obj.instructionsForImproveAgentsWorkflows) ?? str(obj.instructionsForImprovement);
    const instructionsForImprovement = str(obj.instructionsForImprovement);
    const instructionsForImprovementSession = str(obj.instructionsForImprovementSession);
    const instructionsForImprovementHeap = str(obj.instructionsForImprovementHeap);
    // When the route includes agent or workflow, do not pass the simple-question restriction to general
    let sanitizedInstructionsForGeneral = instructionsForGeneral;
    const routeIds = flattenPriorityOrder(priorityOrder);
    if (
      (routeIds.includes("agent") || routeIds.includes("workflow")) &&
      typeof instructionsForGeneral === "string" &&
      /do not create or modify agents or workflows/i.test(instructionsForGeneral)
    ) {
      sanitizedInstructionsForGeneral = undefined;
    }
    return {
      priorityOrder,
      refinedTask: task,
      extractedContext,
      instructionsForGeneral: sanitizedInstructionsForGeneral,
      instructionsForAgent,
      instructionsForWorkflow,
      instructionsForImproveRun,
      instructionsForImproveHeap,
      instructionsForImproveAgentsWorkflows,
      instructionsForImprovement,
      instructionsForImprovementSession,
      instructionsForImprovementHeap,
    };
  } catch {
    return null;
  }
}

function getInstructionForSpecialist(
  plan: PlannerOutput,
  specialistId: string
): string | undefined {
  switch (specialistId) {
    case "general":
      return plan.instructionsForGeneral;
    case "agent":
      return plan.instructionsForAgent;
    case "workflow":
      return plan.instructionsForWorkflow;
    case "improve_run":
      return plan.instructionsForImproveRun ?? plan.instructionsForImprovementSession;
    case "improve_heap":
      return plan.instructionsForImproveHeap ?? plan.instructionsForImprovementHeap;
    case "improve_agents_workflows":
      return plan.instructionsForImproveAgentsWorkflows ?? plan.instructionsForImprovement;
    case "improvement":
      return plan.instructionsForImproveAgentsWorkflows ?? plan.instructionsForImprovement;
    case "improvement_session":
      return plan.instructionsForImproveRun ?? plan.instructionsForImprovementSession;
    case "improvement_heap":
      return plan.instructionsForImproveHeap ?? plan.instructionsForImprovementHeap;
    default:
      if (specialistId.startsWith("improve_agents_workflows__"))
        return plan.instructionsForImproveAgentsWorkflows ?? plan.instructionsForImprovement;
      if (specialistId.startsWith("improvement__"))
        return plan.instructionsForImproveAgentsWorkflows ?? plan.instructionsForImprovement;
      if (specialistId.startsWith("workflow_") || specialistId.startsWith("workflow__"))
        return plan.instructionsForWorkflow;
      return undefined;
  }
}

/**
 * Enriches the task string for a specialist using plan instructions and extractedContext.
 */
export function enrichTaskWithPlan(
  refinedTask: string,
  specialistId: string,
  plan: PlannerOutput,
  previousSteps?: string
): string {
  const instruction = getInstructionForSpecialist(plan, specialistId);
  const parts: string[] = [refinedTask];
  if (typeof instruction === "string" && instruction.trim()) {
    parts.push("\n\nPlan for you:", instruction.trim());
  }
  if (plan.extractedContext && Object.keys(plan.extractedContext).length > 0) {
    parts.push("\n\nExtracted context (use these values):", JSON.stringify(plan.extractedContext));
  }
  if (previousSteps && previousSteps.trim()) {
    parts.push("\n\nPrevious steps:\n", previousSteps.trim());
  }
  return parts.join("");
}

/**
 * Infers a fallback priorityOrder when the planner returns empty or invalid.
 * Uses simple keyword heuristics so "create agent" / "create workflow" / "run workflow" still route to agent and workflow.
 */
export function inferFallbackPriorityOrder(
  message: string,
  recentContext: string | undefined,
  registry: SpecialistRegistry
): string[] {
  const text = [message, recentContext ?? ""].join(" ").toLowerCase();
  const hasAgent = /\b(create|add|build|make)\s+(an?\s+)?agent\b|\bagent\s+(create|add)\b/i.test(
    text
  );
  const hasWorkflow =
    /\b(create|add|build|make|run|execute)\s+(a\s+)?workflow\b|\bworkflow\s+(create|run|execute)\b|\brun\s+the\s+workflow\b/i.test(
      text
    );
  const order: string[] = [];
  if (hasAgent && "agent" in registry.specialists) order.push("agent");
  if (hasWorkflow && "workflow" in registry.specialists) order.push("workflow");
  if (order.length > 0) return order;
  const first = registry.topLevelIds[0];
  return first ? [first] : [];
}

/** Known confirmation strings for "improvement type" (prompt/workflow only vs model training). */
const PROMPT_AND_WORKFLOW_PATTERNS = [
  "prompt and workflow only",
  "1 — prompt and workflow only",
  "1 - prompt and workflow only",
];
const MODEL_TRAINING_PATTERNS = [
  "also model training",
  "2 — also model training",
  "2 - also model training",
];
const EXPLAIN_PATTERNS = [
  "explain the difference",
  "3 — explain the difference",
  "3 - explain the difference",
];

/**
 * When the previous plan implies create-agent + create-workflow and the user's reply is a short
 * confirmation of the improvement-type option, returns a merged plan (previous plan + selfImprovementType
 * in extractedContext). Otherwise returns null so the caller can use the planner LLM.
 */
export function mergePlanOnImprovementTypeConfirmation(
  previousPlan: PlannerOutput,
  userReply: string
): PlannerOutput | null {
  if (!planImpliesCreateAgentAndWorkflow(previousPlan)) return null;
  const normalized = userReply.trim().toLowerCase();
  if (normalized.length === 0) return null;

  let selfImprovementType: string | undefined;
  if (
    normalized === "1" ||
    normalized.startsWith("1 —") ||
    normalized.startsWith("1 -") ||
    PROMPT_AND_WORKFLOW_PATTERNS.some((p) => normalized.includes(p))
  ) {
    selfImprovementType = "prompt_and_workflow_only";
  } else if (
    normalized === "2" ||
    normalized.startsWith("2 —") ||
    normalized.startsWith("2 -") ||
    MODEL_TRAINING_PATTERNS.some((p) => normalized.includes(p))
  ) {
    selfImprovementType = "model_training";
  } else if (
    normalized === "3" ||
    normalized.startsWith("3 —") ||
    normalized.startsWith("3 -") ||
    EXPLAIN_PATTERNS.some((p) => normalized.includes(p))
  ) {
    selfImprovementType = "explain_difference";
  } else {
    return null;
  }

  return {
    ...previousPlan,
    extractedContext: {
      ...previousPlan.extractedContext,
      selfImprovementType,
    },
  };
}

/**
 * Builds the planner prompt for a continuation turn: previous plan + user reply.
 * Planner outputs an updated plan (merge) so refinedTask, extractedContext, or priorityOrder can change with the user request.
 */
export function buildPlannerContinuationPrompt(
  previousPlan: PlannerOutput,
  userReply: string,
  registry: SpecialistRegistry
): string {
  const ids = registry.topLevelIds.slice(0, ROUTER_OPTIONS_CAP);
  const specialistList = ids
    .map((id) => {
      const entry = registry.specialists[id];
      const desc = entry?.description ? ` — ${entry.description}` : "";
      return `- ${id}${desc}`;
    })
    .join("\n");

  const previousPlanJson = JSON.stringify(
    {
      priorityOrder: previousPlan.priorityOrder,
      refinedTask: previousPlan.refinedTask,
      extractedContext: previousPlan.extractedContext,
    },
    null,
    2
  );

  const prompt = `You are a planner. The user is continuing from the previous turn. Your job is to output an **updated** plan as a single JSON object.

Previous plan:
---
${previousPlanJson}
---

User's reply (they may have selected an option or added a refinement):
---
${userReply}
---

Available specialists (use their ids in priorityOrder): ${ids.join(", ")}

Output exactly one JSON object, no other text, in this form:
{
  "priorityOrder": [...],
  "refinedTask": "...",
  "extractedContext": { ... },
  "instructionsForGeneral": "...",
  "instructionsForAgent": "...",
  "instructionsForWorkflow": "...",
  "instructionsForImproveRun": "...",
  "instructionsForImproveHeap": "...",
  "instructionsForImproveAgentsWorkflows": "..."
}

Rules:
- If the user only confirmed an option (e.g. "Run with defaults now", "Create the agent + workflow..."), keep priorityOrder and extractedContext from the previous plan; you may slightly update refinedTask to reflect their choice.
- If the user changed intent (e.g. different URL, "don't run", "only create the agent"), update refinedTask, extractedContext, or priorityOrder accordingly. Preserve every URL and identifier in extractedContext.
- priorityOrder must be an array of specialist ids from: ${ids.join(", ")}.`;
  return prompt;
}
