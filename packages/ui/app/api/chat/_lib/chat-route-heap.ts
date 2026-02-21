/**
 * Heap (multi-agent) mode turn: router → planner → run specialists.
 * Extracted from chat route for maintainability.
 */
import type { LLMConfig } from "@agentron-studio/core";
import type {
  LLMRequest,
  LLMResponse,
  PlannerOutput,
  StudioContext,
} from "@agentron-studio/runtime";
import {
  runAssistant,
  createDefaultLLMManager,
  getRegistry,
  getToolsForSpecialist,
  runHeap,
  buildPlannerPrompt,
  buildPlannerContinuationPrompt,
  parsePlanOutput,
  mergePlanOnImprovementTypeConfirmation,
  enrichTaskWithPlan,
  expandToLeaves,
  inferFallbackPriorityOrder,
  planImpliesCreateAgentAndWorkflow,
  reorderAgentBeforeWorkflow,
  reorderAgentAndWorkflowBeforeImproveAgentsWorkflows,
  PLANNER_RETRY_INSTRUCTION,
} from "@agentron-studio/runtime";
import { executeTool, resolveTemplateVars } from "./execute-tool";
import { buildSpecialistSummaryWithCreatedIds } from "../../_lib/chat-helpers";
import {
  extractContentFromRawResponse,
  buildRecentConversationContext,
  capForTrace,
  TRACE_TOOL_PAYLOAD_MAX,
  IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE,
  AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION,
  AGENT_SPECIALIST_AGENTIC_BLOCKS,
} from "./chat-route-shared";

/** Run one turn in heap (multi-agent) mode: router LLM → run heap with specialists; returns assistant-shaped result and the plan used (for pending plan storage). */
export async function runHeapModeTurn(opts: {
  effectiveMessage: string;
  callLLM: (req: LLMRequest) => Promise<LLMResponse>;
  executeToolCtx: {
    conversationId: string | undefined;
    vaultKey: Buffer | null | undefined;
    registry?: ReturnType<typeof getRegistry>;
  };
  registry: ReturnType<typeof getRegistry>;
  manager: ReturnType<typeof createDefaultLLMManager>;
  llmConfig: LLMConfig | null;
  pushUsage: (response: LLMResponse) => void;
  enqueueTrace?: (step: {
    phase: string;
    label?: string;
    specialistId?: string;
    toolName?: string;
    toolInput?: unknown;
    toolOutput?: unknown;
    contentPreview?: string;
    /** Heap route from router (for heap_route trace step). */ priorityOrder?: unknown;
    refinedTask?: string;
    plannerPrompt?: unknown;
    rawResponse?: unknown;
    parsedPlan?: unknown;
    /** Text extracted from response and used for parsing (so UI can show what was parsed). */ extractedTextForParsing?: string;
    /** When no plan was derived, human-readable reason (e.g. empty content, finish_reason length). */ noPlanReason?: string;
    expandedOrder?: unknown;
    /** Short slice of response.raw for debugging (included whenever provider returns raw). */ rawPreview?: string;
  }) => void;
  /** When set, heap sets this to the current specialist id so LLM trace steps can include specialistId. */
  currentSpecialistIdRef?: { current: string | null };
  /** Short recent conversation for planner (extractedContext and intent). */
  recentConversationContext?: string;
  /** When set, a run is waiting for user input; planner should route to workflow and set instructionsForWorkflow for respond_to_run when user message looks like a direct reply. */
  runWaitingContext?: string;
  /** When set, use continuation prompt (merge) so the plan is updated with the user's reply. */
  pendingPlan?: PlannerOutput | null;
  feedbackInjection?: string;
  ragContext?: string;
  uiContext?: string;
  studioContext?: StudioContext;
  systemPromptOverride?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{
  content: string;
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[];
  plan: PlannerOutput | null;
  refinedTask: string;
  priorityOrder: (string | { parallel: string[] })[];
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
}> {
  const {
    effectiveMessage,
    callLLM,
    executeToolCtx,
    registry,
    manager,
    llmConfig,
    pushUsage,
    enqueueTrace,
    currentSpecialistIdRef,
  } = opts;
  const traceId = crypto.randomUUID();
  enqueueTrace?.({ phase: "router", label: "Planning…" });

  const useContinuationPrompt = opts.pendingPlan != null;
  let plan: PlannerOutput | null = null;
  let plannerResponse: LLMResponse | null = null;
  let plannerText = "";

  if (useContinuationPrompt) {
    const mergedPlan = mergePlanOnImprovementTypeConfirmation(opts.pendingPlan!, effectiveMessage);
    if (mergedPlan != null) {
      plan = mergedPlan;
      enqueueTrace?.({
        phase: "planner_response",
        label: "Plan merged from confirmation",
        parsedPlan: plan,
      });
    }
  }

  if (plan === null) {
    const plannerPrompt = useContinuationPrompt
      ? buildPlannerContinuationPrompt(opts.pendingPlan!, effectiveMessage, registry)
      : buildPlannerPrompt(
          effectiveMessage,
          registry,
          opts.recentConversationContext,
          opts.runWaitingContext
        );
    enqueueTrace?.({
      phase: "planner_request",
      label: useContinuationPrompt ? "Planner input (continuation)" : "Planner input",
      plannerPrompt,
    });

    function getPlannerText(res: LLMResponse): string {
      const fromContent = (res.content ?? "").trim();
      if (fromContent.length > 0) return fromContent;
      return extractContentFromRawResponse(res.raw);
    }

    try {
      plannerResponse = await manager.chat(
        llmConfig as LLMConfig,
        {
          messages: [{ role: "user", content: plannerPrompt }],
          temperature: 0.2,
          maxTokens: 8192,
        },
        { source: "chat" }
      );
      pushUsage(plannerResponse);
      plannerText = getPlannerText(plannerResponse);
      plan = parsePlanOutput(plannerText);
      if (plan == null && !useContinuationPrompt) {
        plannerResponse = await manager.chat(
          llmConfig as LLMConfig,
          {
            messages: [{ role: "user", content: plannerPrompt + PLANNER_RETRY_INSTRUCTION }],
            temperature: 0.2,
            maxTokens: 8192,
          },
          { source: "chat" }
        );
        pushUsage(plannerResponse);
        plannerText = getPlannerText(plannerResponse);
        plan = parsePlanOutput(plannerText);
      }
    } finally {
      const rawContent = plannerText;
      const rawToUse =
        plannerResponse?.raw != null
          ? plannerResponse.raw
          : plannerResponse != null
            ? {
                content: plannerResponse.content,
                id: plannerResponse.id,
                usage: plannerResponse.usage,
              }
            : undefined;
      const rawPreviewForTrace =
        rawToUse != null
          ? typeof rawToUse === "object"
            ? JSON.stringify(rawToUse)
            : String(rawToUse)
          : undefined;
      const rawResponseForTrace =
        rawContent.length > 0
          ? rawContent
          : (rawPreviewForTrace ?? "(Planner returned no text; no response from provider.)");
      let noPlanReason: string | undefined;
      if (plan == null && rawToUse != null && typeof rawToUse === "object") {
        const choices = (rawToUse as Record<string, unknown>).choices;
        const fr =
          Array.isArray(choices) && choices.length > 0
            ? (choices[0] as Record<string, unknown>)?.finish_reason
            : undefined;
        if (rawContent.length === 0) {
          noPlanReason =
            typeof fr === "string"
              ? `Model returned no text (finish_reason: ${fr}). For reasoning models, increase planner max_tokens so the model can output after reasoning.`
              : "Model returned no text. No plan could be parsed.";
        } else {
          noPlanReason =
            "Response text could not be parsed as a valid plan (invalid JSON or missing fields).";
        }
      }
      enqueueTrace?.({
        phase: "planner_response",
        label: "Planner output",
        rawResponse: rawResponseForTrace,
        parsedPlan: plan ?? undefined,
        extractedTextForParsing: rawContent.length > 0 ? rawContent : undefined,
        ...(noPlanReason != null && { noPlanReason }),
        ...(rawPreviewForTrace != null && { rawPreview: rawPreviewForTrace }),
      });
    }
  }

  const fallbackOrder =
    plan == null
      ? inferFallbackPriorityOrder(effectiveMessage, opts.recentConversationContext, registry)
      : registry.topLevelIds[0]
        ? [registry.topLevelIds[0]]
        : [];
  const rawOrder = plan?.priorityOrder ?? fallbackOrder;
  const priorityOrder: (string | { parallel: string[] })[] = Array.isArray(rawOrder)
    ? rawOrder
        .map((step) => {
          if (typeof step === "string") return step in registry.specialists ? step : null;
          if (
            step &&
            typeof step === "object" &&
            Array.isArray((step as { parallel?: string[] }).parallel)
          ) {
            const filtered = (step as { parallel: string[] }).parallel.filter(
              (id) => id in registry.specialists
            );
            return filtered.length > 0 ? { parallel: filtered } : null;
          }
          return null;
        })
        .filter((s): s is string | { parallel: string[] } => s !== null)
    : fallbackOrder;
  const refinedTask = plan?.refinedTask ?? effectiveMessage;

  const routeLabelPart = priorityOrder
    .map((s) =>
      typeof s === "string"
        ? s
        : Array.isArray((s as { parallel?: string[] }).parallel)
          ? `[${(s as { parallel: string[] }).parallel.join(", ")}]`
          : String(s)
    )
    .join(" → ");
  enqueueTrace?.({
    phase: "heap_route",
    label: `Route: ${routeLabelPart || "—"}`,
    priorityOrder,
    refinedTask,
    ...(plan && {
      extractedContext: plan.extractedContext,
      instructionsForGeneral: plan.instructionsForGeneral,
      instructionsForAgent: plan.instructionsForAgent,
      instructionsForWorkflow: plan.instructionsForWorkflow,
      instructionsForImproveRun: plan.instructionsForImproveRun,
      instructionsForImproveHeap: plan.instructionsForImproveHeap,
      instructionsForImproveAgentsWorkflows: plan.instructionsForImproveAgentsWorkflows,
      instructionsForImprovement: plan.instructionsForImprovement,
      instructionsForImprovementSession: plan.instructionsForImprovementSession,
      instructionsForImprovementHeap: plan.instructionsForImprovementHeap,
    }),
  });

  const chooseSubspecialist = async (
    optionIds: string[],
    task: string,
    parentId: string
  ): Promise<string | null> => {
    if (optionIds.length === 0) return null;
    if (optionIds.length === 1) return optionIds[0];
    try {
      const prompt = `Task: ${task.slice(0, 400)}\nParent specialist: ${parentId}\nWhich subspecialist should handle this? Reply with exactly one id from: ${optionIds.join(", ")}`;
      const res = await manager.chat(
        llmConfig as LLMConfig,
        {
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          maxTokens: 128,
        },
        { source: "chat" }
      );
      pushUsage(res);
      const text = (res.content ?? "").trim();
      const chosen = optionIds.find((id) => text.includes(id)) ?? optionIds[0];
      return chosen;
    } catch {
      return optionIds[0];
    }
  };

  let orderToRun = priorityOrder;
  try {
    orderToRun = await expandToLeaves(priorityOrder, registry, refinedTask, chooseSubspecialist, 5);
  } catch {
    orderToRun = priorityOrder;
  }
  if (orderToRun !== priorityOrder) {
    enqueueTrace?.({
      phase: "heap_expand",
      label: "Expanded to leaf specialists",
      expandedOrder: orderToRun,
    });
  }

  if (plan && planImpliesCreateAgentAndWorkflow(plan)) {
    let reordered = reorderAgentBeforeWorkflow(orderToRun);
    if (reordered !== orderToRun) {
      orderToRun = reordered;
      enqueueTrace?.({
        phase: "heap_expand",
        label: "Reordered so agent runs before workflow (create-both)",
        expandedOrder: orderToRun,
      });
    }
    reordered = reorderAgentAndWorkflowBeforeImproveAgentsWorkflows(orderToRun);
    if (reordered !== orderToRun) {
      orderToRun = reordered;
      enqueueTrace?.({
        phase: "heap_expand",
        label: "Reordered so agent and workflow run before improve_agents_workflows (create-both)",
        expandedOrder: orderToRun,
      });
    }
  }

  enqueueTrace?.({ phase: "heap", label: "Running specialists…" });

  const allHeapToolResults: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
  type RunSpecialist = (
    specialistId: string,
    task: string,
    context: { steps: { specialistId: string; outcome: string }[] }
  ) => Promise<{ summary: string }>;
  const runSpecialistInner: RunSpecialist = async (specialistId, task, context) => {
    const specialist = registry.specialists[specialistId];
    if (!specialist) return { summary: `Unknown specialist: ${specialistId}.` };
    const toolNames = getToolsForSpecialist(registry, specialistId);
    const contextStr = context.steps.length
      ? context.steps.map((s) => `${s.specialistId}: ${s.outcome}`).join("\n")
      : "";
    const specialistMessage = task;
    const priorResults: { name: string; result: unknown }[] = [];
    const execTool = async (name: string, args: Record<string, unknown>) => {
      if (!toolNames.includes(name)) {
        return { error: "Tool not available for this specialist." };
      }
      const resolved = resolveTemplateVars(args, priorResults);
      enqueueTrace?.({
        phase: "heap_tool",
        label: `${specialistId} → ${name}`,
        specialistId,
        toolName: name,
        toolInput: capForTrace(resolved, TRACE_TOOL_PAYLOAD_MAX),
      });
      const result = await executeTool(name, resolved, executeToolCtx);
      priorResults.push({ name, result });
      enqueueTrace?.({
        phase: "heap_tool_done",
        label: `${specialistId} → ${name}`,
        specialistId,
        toolName: name,
        toolOutput: capForTrace(result, TRACE_TOOL_PAYLOAD_MAX),
      });
      return result;
    };
    const planSaysCreateAgentWithContext =
      plan &&
      /create\s+(?:an?\s+)?agent/i.test(plan.instructionsForAgent ?? "") &&
      plan.extractedContext &&
      (typeof (plan.extractedContext as Record<string, unknown>).runNow !== "undefined" ||
        (plan.extractedContext as Record<string, unknown>).savedSearchId ||
        (plan.extractedContext as Record<string, unknown>).savedSearchUrl);
    const agentCreateWithDefaultsHint =
      specialistId === "agent" && planSaysCreateAgentWithContext
        ? '\nWhen the plan says to create a new agent and extracted context has runNow or identifiers (e.g. savedSearchId, savedSearchUrl), use the default "Prompt and workflow improvement only" and output create_agent (and list_tools with category improvement, subset prompt_and_topology if needed) in your first response; do not call ask_user for the training option (A/B/C) first.'
        : "";
    const agentCreationBlock =
      specialistId === "agent"
        ? `
CRITICAL — create_agent must produce a runnable agent: Every create_agent call MUST include either (1) systemPrompt (top-level string) or (2) graphNodes with at least one node of type "llm" where parameters.systemPrompt is a concrete, non-empty string. If you only pass name, description, llmConfigId, and toolIds without systemPrompt and without graphNodes, the agent will have an empty graph and will do nothing when a workflow runs it. Minimum runnable example: graphNodes: [{"id": "n1", "type": "llm", "position": [100, 100], "parameters": {"systemPrompt": "<role and behavior in 1–3 sentences>"}}], plus graphEdges if you add tool nodes. Use the agent's description as the basis for the system prompt when the plan does not specify one. Use as much detail in systemPrompt or graphNodes as the agent needs.
${agentCreateWithDefaultsHint}
${AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION}
When creating an agent that requires several user inputs (e.g. content types, run frequency, vault usage, export format): collect them one topic at a time. Call ask_user with the first topic's question and that topic's options only; after the user replies, ask the next topic with its options; repeat until all are answered. Only then call create_agent/create_workflow with the collected inputs and pass them into the agent. Do NOT present all topic titles as one list of options.

Tool cap and multi-agent system design:
- create_agent accepts at most 10 tools per agent (toolIds length ≤ 10). If you pass more, the tool returns TOOL_CAP_EXCEEDED; do not retry with the same list.
- When the user's goal would require more than 10 tools: You must design and create a multi-agent system using agentic/meta-workflow patterns. You only have agent tools; the workflow specialist will create and wire the workflow. (1) Choose a pattern that fits the goal: Pipeline (A→B→C) for sequential steps; Evaluator-optimizer (A↔B with maxRounds) for generate-and-critique; Role-based assembly line (e.g. researcher → writer → reviewer); Orchestrator-workers (one coordinator, multiple workers). (2) Group tools by role (e.g. browser/vault/fetch for collector, improvement tools for improver). (3) Create one agent per role with create_agent (at most 10 toolIds each), report each with "[Created agent id: ...]" and in your summary indicate the pattern (e.g. "Pipeline: Collector → Improver") so the workflow specialist can wire edges and maxRounds.
- When ≤10 tools suffice: Create one agent and report its id; the workflow specialist will create a single-node workflow.
- On TOOL_CAP_EXCEEDED: If a create_agent result has code "TOOL_CAP_EXCEEDED", you MUST retry by designing a multi-agent system using an agentic pattern: create multiple agents (each ≤10 tools, one role per pattern), report each with "[Created agent id: ...]". The workflow specialist will then create and wire the workflow. Do not retry with the same single-agent call.`
        : "";
    const improvementLoopBlock =
      specialistId === "improve_agents_workflows" ||
      specialistId.startsWith("improve_agents_workflows__")
        ? `
Improvement scope: You make persistent changes to workflow agents and workflows only (studio DB). You do not modify the heap or create session-only changes. All update_agent, update_workflow, create_tool calls are persisted.
${IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE} Only use your tools to observe existing runs (get_run_for_improvement, get_feedback_for_scope) and then act (update_agent, update_workflow). If there is no runId or agentId to observe yet, output a brief handoff (e.g. "Creation will be done by agent and workflow specialists.") and no tool calls that ask for creation params.
Do not judge the whole list of tools. Options are structured in the heap. First call get_specialist_options('improve_agents_workflows') to get option groups (observe, act_prompt, act_topology, act_training, evaluate). Judge which group(s) are meaningful for the task; then call tools from those groups only.
Loop: 1) Observe — get_run_for_improvement(runId), get_feedback_for_scope(agentId). 2) Decide — which group(s): act_prompt, act_topology, or act_training. 3) Act — call tools from the chosen group(s). 4) Evaluate — execute_workflow or ask_user("Goal achieved?" ["Done", "Retry"]). Stop when Done or after 2–3 rounds. Use the plan's instructionsForImproveAgentsWorkflows and extractedContext when provided.`
        : "";
    const workflowAgentUuidBlock =
      specialistId === "workflow" || specialistId.startsWith("workflow__")
        ? `
For update_workflow, every agent node must have parameters.agentId set to the agent's UUID (id), never the agent's name. If Previous steps include "[Created agent id: <uuid>]", use that exact uuid for parameters.agentId. Otherwise call list_agents and set parameters.agentId to the matching agent's id.
If Previous steps say an agent was created (e.g. "Created a runnable agent", "created ... agent") but do not include "[Created agent id: ...]", call list_agents and use the matching agent's id (by name or most recent) for parameters.agentId; then create/update the workflow and run if the user asked to run. Do not ask the user for the agent UUID in that case.
Workflow id: For update_workflow, add_workflow_edges, and execute_workflow always pass the workflow by id (UUID). Use the id from create_workflow result in this turn, or from "[Created workflow id: <uuid>]" in Previous steps, or from Studio resources (Workflows: name (id)) when the user asked to run a workflow and exactly one workflow is listed. Pass it as "id" or "workflowId" in the tool arguments — never identify the workflow by name. If the user said "run the workflow" or "run it" and you have one workflow in Studio resources or in Previous steps, use that workflow's id for execute_workflow — do not skip the call for lack of id.
When execute_workflow returns status "failed", always report result.error to the user. On "Agent not found" or missing/invalid agentId: call get_workflow to inspect the workflow, fix parameters.agentId (e.g. from list_agents or from "[Created agent id: ...]" in previous steps), call update_workflow, then offer to re-run.
You may try fixing the problem yourself first (e.g. create the missing agent if the workflow expects one, then update_workflow with the new agent id and re-run execute_workflow). Only if the fix is ambiguous or fails, report the failure and options to the user.`
        : "";
    const choiceBlock = toolNames.includes("ask_user")
      ? `
When presenting choices: call ask_user with question and 2–4 options. Output exactly ONE ask_user call per response when you need multiple answers (e.g. config questions): ask the first topic only, wait for the user's reply, then in the next turn ask the next topic. Do not output multiple ask_user calls in one response.
In this chat context you must use ask_user only. Do not use std-request-user-help or "Request user input (workflow pause)" — that tool is for workflow runs, not for chat; here the user replies in the next message.
When asking which workflow or agent to use (run, update, enable, etc.): first call list_workflows or list_agents if needed, then in your message include the concrete names so the user knows what they are choosing (e.g. "Current workflows: **LinkedIn Niche Browsing**, **Extract Config**. Which should I run?"). Never say only "I listed your agents and workflows" without listing the names in the same message.
Prefer acting with sensible defaults when the user's intent is clear from the task or previous steps; use ask_user only when genuinely ambiguous (e.g. multiple options and no clear prior choice).`
      : `
When the previous step is waiting for user input, do not call tools that require user input. Respond with a brief summary of what will happen once the user replies.`;
    const studioContextForSpecialist =
      specialistId === "agent"
        ? opts.studioContext
        : opts.studioContext
          ? { ...opts.studioContext, tools: [] }
          : undefined;
    const result = await runAssistant([], specialistMessage, {
      callLLM,
      executeTool: execTool,
      systemPromptOverride: `You are the "${specialistId}" specialist. Use only these tools: ${toolNames.join(", ")}. Complete the task and respond with a brief summary.
When the task requires creating, updating, or configuring agents, workflows, or tools, you MUST output <tool_call> blocks in your FIRST response. Use this format: <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>. Do not respond with only a summary or "I will..." — output the actual tool calls immediately so the system can execute them.${choiceBlock}${agentCreationBlock}${specialistId === "agent" ? AGENT_SPECIALIST_AGENTIC_BLOCKS : ""}${improvementLoopBlock}${workflowAgentUuidBlock}`,
      feedbackInjection: opts.feedbackInjection,
      ragContext: opts.ragContext,
      uiContext: opts.uiContext,
      studioContext: studioContextForSpecialist,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens ?? 16384,
    });
    if (result.toolResults.length > 0) {
      for (const tr of result.toolResults) {
        allHeapToolResults.push({ name: tr.name, args: tr.args, result: tr.result });
      }
    }
    const summary = buildSpecialistSummaryWithCreatedIds(result.content ?? "", result.toolResults);
    return { summary };
  };

  const runSpecialist: RunSpecialist = async (specialistId, task, context) => {
    const contextStr = context.steps.length
      ? context.steps.map((s) => `${s.specialistId}: ${s.outcome}`).join("\n")
      : "";
    const effectiveTask = plan
      ? enrichTaskWithPlan(refinedTask, specialistId, plan, contextStr)
      : (contextStr ? `${task}\n\nPrevious steps:\n${contextStr}` : task) +
        (opts.recentConversationContext
          ? "\n\nRecent conversation (use for URLs, IDs, and intent):\n" +
            opts.recentConversationContext
          : "");
    enqueueTrace?.({
      phase: "heap_specialist",
      label: `Specialist ${specialistId}…`,
      specialistId,
    });
    if (currentSpecialistIdRef) currentSpecialistIdRef.current = specialistId;
    try {
      const result = await runSpecialistInner(specialistId, effectiveTask, context);
      enqueueTrace?.({
        phase: "heap_specialist_done",
        label: `${specialistId}: ${result.summary.slice(0, 80)}${result.summary.length > 80 ? "…" : ""}`,
        specialistId,
        contentPreview: result.summary,
      });
      return result;
    } finally {
      if (currentSpecialistIdRef) currentSpecialistIdRef.current = null;
    }
  };

  const heapResult = await runHeap(orderToRun, refinedTask, runSpecialist, registry, {
    traceId,
    log: (msg, data) => {
      if (typeof console !== "undefined" && console.info) {
        console.info(msg, data ?? "");
      }
    },
  });

  return {
    content: heapResult.summary,
    toolResults: allHeapToolResults,
    plan: plan ?? null,
    refinedTask,
    priorityOrder,
    reasoning: undefined,
    todos: undefined,
    completedStepIndices: undefined,
  };
}
