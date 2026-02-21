import { describe, it, expect } from "vitest";
import {
  getRegistry,
  applyRegistryCaps,
  mergeRegistryOverrides,
  getSpecialistOptions,
  getPrimaryTopLevelIds,
  getSubspecialistParent,
  getChildSpecialistIds,
  getOptionsAtNode,
  getToolsForSpecialist,
  searchHeapPath,
  type ChooseFn,
  HEAP_OPTIONS_CAP,
  SPECIALIST_TOOL_CAP,
  TOP_LEVEL_CAP,
  DELEGATE_TARGETS_CAP,
  buildRegistryFromSpecs,
  buildRouterPrompt,
  parseRouterOutput,
  buildPlannerPrompt,
  buildPlannerContinuationPrompt,
  parsePlanOutput,
  mergePlanOnImprovementTypeConfirmation,
  enrichTaskWithPlan,
  inferFallbackPriorityOrder,
  planImpliesCreateAgentAndWorkflow,
  reorderAgentBeforeWorkflow,
  reorderAgentAndWorkflowBeforeImproveAgentsWorkflows,
  isImproveAgentsWorkflowsId,
  PLANNER_RETRY_INSTRUCTION,
  buildHeapDAG,
  runHeap,
  runHeapFromDAG,
  DEFAULT_HEAP_DEPTH_LIMIT,
} from "@agentron-studio/runtime";
import type { SpecialistRegistry, SpecialistEntry, HeapStep } from "@agentron-studio/runtime";

describe("heap registry", () => {
  it("getRegistry() returns default registry with expected top-level ids and specialists", () => {
    const reg = getRegistry();
    expect(reg.topLevelIds).toEqual([
      "general",
      "workflow",
      "agent",
      "tools",
      "improve_run",
      "improve_heap",
      "improve_agents_workflows",
    ]);
    const ids = Object.keys(reg.specialists).sort();
    expect(ids).toEqual(
      expect.arrayContaining([
        "agent",
        "agent_lifecycle",
        "agent_openclaw",
        "general",
        "improve_run",
        "improve_heap",
        "improve_agents_workflows",
        "planner",
        "tools",
        "workflow",
      ])
    );
    expect(reg.specialists.general?.toolNames.length).toBeLessThanOrEqual(SPECIALIST_TOOL_CAP);
    // Workflow may be a delegator (when > SPECIALIST_TOOL_CAP tools) with workflow__partN; collect tools from workflow and any part
    const workflowToolNames = (Object.entries(reg.specialists) as [string, SpecialistEntry][])
      .filter(([id]) => id === "workflow" || id.startsWith("workflow__"))
      .flatMap(([, e]) => e.toolNames ?? []);
    expect(workflowToolNames).toContain("execute_workflow");
    expect(reg.specialists.planner).toBeDefined();
    expect(reg.specialists.planner?.toolNames).toEqual([]);
    // Agent is a delegator; combined tools from agent_lifecycle + agent_openclaw include lifecycle and OpenClaw tools
    const agentToolNames = getToolsForSpecialist(reg, "agent");
    expect(agentToolNames).toContain("ask_user");
    expect(agentToolNames).toContain("send_to_openclaw");
    expect(agentToolNames).toContain("openclaw_history");
    expect(agentToolNames).toContain("openclaw_abort");
    expect(reg.specialists.agent_lifecycle).toBeDefined();
    expect(reg.specialists.agent_openclaw).toBeDefined();
    expect(reg.specialists.agent__part1).toBeUndefined();
    expect(reg.specialists.agent__part2).toBeUndefined();
    expect(reg.specialists.agent?.optionGroups).toBeDefined();
    expect(reg.specialists.agent?.optionGroups?.agent_lifecycle).toBeDefined();
    expect(reg.specialists.agent?.optionGroups?.openclaw).toBeDefined();
    expect(reg.specialists.agent?.optionGroups?.openclaw?.toolIds).toEqual([
      "send_to_openclaw",
      "openclaw_history",
      "openclaw_abort",
    ]);
  });

  it("applyRegistryCaps trims topLevelIds to TOP_LEVEL_CAP", () => {
    const reg: SpecialistRegistry = {
      topLevelIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      specialists: { a: { id: "a", toolNames: [] } },
    };
    const capped = applyRegistryCaps(reg);
    expect(capped.topLevelIds).toHaveLength(TOP_LEVEL_CAP);
    expect(capped.topLevelIds).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("applyRegistryCaps trims toolNames to SPECIALIST_TOOL_CAP", () => {
    const tools = Array.from({ length: 15 }, (_, i) => `tool_${i}`);
    const reg: SpecialistRegistry = {
      topLevelIds: ["x"],
      specialists: { x: { id: "x", toolNames: tools } },
    };
    const capped = applyRegistryCaps(reg);
    expect(capped.specialists.x?.toolNames).toHaveLength(SPECIALIST_TOOL_CAP);
    expect(capped.specialists.x?.toolNames).toEqual(tools.slice(0, SPECIALIST_TOOL_CAP));
  });

  it("applyRegistryCaps trims delegateTargets to DELEGATE_TARGETS_CAP", () => {
    const targets = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const reg: SpecialistRegistry = {
      topLevelIds: ["d"],
      specialists: { d: { id: "d", toolNames: [], delegateTargets: targets } },
    };
    const capped = applyRegistryCaps(reg);
    expect(capped.specialists.d?.delegateTargets).toHaveLength(DELEGATE_TARGETS_CAP);
  });

  it("getRegistry(override) uses override registry", () => {
    const custom: SpecialistRegistry = {
      topLevelIds: ["only"],
      specialists: { only: { id: "only", toolNames: ["ask_user"] } },
    };
    const reg = getRegistry(custom);
    expect(reg.topLevelIds).toEqual(["only"]);
    expect(reg.specialists.only?.toolNames).toEqual(["ask_user"]);
  });

  it("buildRegistryFromSpecs splits specialists with more than SPECIALIST_TOOL_CAP tools into a delegator hierarchy", () => {
    const manyTools = Array.from({ length: SPECIALIST_TOOL_CAP + 3 }, (_, i) => `tool_${i}`);
    const reg = buildRegistryFromSpecs(
      [
        {
          id: "big",
          description: "Big specialist",
          toolNames: manyTools,
        },
      ],
      ["big"]
    );

    // Top-level id stays the logical id.
    expect(reg.topLevelIds).toEqual(["big"]);

    const big = reg.specialists.big;
    expect(big).toBeDefined();
    expect(big?.toolNames).toEqual([]);
    expect(big?.delegateTargets && big.delegateTargets.length).toBeGreaterThan(0);

    // All concrete specialists respect the tool cap.
    Object.values(reg.specialists).forEach((entry) => {
      expect(entry.toolNames.length).toBeLessThanOrEqual(SPECIALIST_TOOL_CAP);
      if (entry.delegateTargets) {
        expect(entry.delegateTargets.length).toBeLessThanOrEqual(DELEGATE_TARGETS_CAP);
      }
    });
  });

  it("getPrimaryTopLevelIds returns ids that are not subspecialists of another top-level", () => {
    const reg = getRegistry();
    const primary = getPrimaryTopLevelIds(reg);
    expect(primary).toEqual(
      expect.arrayContaining([
        "general",
        "workflow",
        "agent",
        "tools",
        "improve_run",
        "improve_heap",
        "improve_agents_workflows",
      ])
    );
    expect(primary).not.toContain("improve_agents_workflows__part1");
  });

  it("getSubspecialistParent returns parent for improve_agents_workflows__part1", () => {
    const reg = getRegistry();
    expect(getSubspecialistParent("improve_agents_workflows__part1", reg)).toBe(
      "improve_agents_workflows"
    );
    expect(getSubspecialistParent("general", reg)).toBeNull();
    expect(getSubspecialistParent("improve_agents_workflows", reg)).toBeNull();
  });

  it("mergeRegistryOverrides merges overlay specialists and getRegistry(overrides) returns merged registry", () => {
    const base = getRegistry();
    const overrides: SpecialistEntry[] = [
      {
        id: "custom_specialist",
        description: "Custom",
        toolNames: ["ask_user", "format_response"],
      },
    ];
    const merged = mergeRegistryOverrides(base, overrides);
    expect(merged.specialists.custom_specialist).toBeDefined();
    expect(merged.specialists.custom_specialist?.toolNames).toEqual([
      "ask_user",
      "format_response",
    ]);
    // Default registry is at TOP_LEVEL_CAP (7), so overlay id is not appended to topLevelIds
    expect(merged.topLevelIds.length).toBe(TOP_LEVEL_CAP);
    expect(merged.topLevelIds).not.toContain("custom_specialist");

    const regFromOverrides = getRegistry(overrides);
    expect(regFromOverrides.specialists.custom_specialist).toBeDefined();
    expect(regFromOverrides.topLevelIds.length).toBe(TOP_LEVEL_CAP);
    expect(regFromOverrides.topLevelIds).not.toContain("custom_specialist");
  });
});

describe("heap specialist options (getSpecialistOptions)", () => {
  const reg = getRegistry();

  it("getSpecialistOptions(registry) returns options for all top-level specialists", () => {
    const options = getSpecialistOptions(reg);
    expect(Array.isArray(options)).toBe(true);
    const ids = options.map((o) => o.specialistId);
    expect(ids).toContain("improve_run");
    expect(ids).toContain("improve_heap");
    expect(ids).toContain("improve_agents_workflows");
    expect(ids).toContain("general");
    expect(ids).toContain("workflow");
    expect(ids).toContain("agent");
    options.forEach((o) => {
      expect(o.optionGroups).toBeDefined();
      expect(typeof o.optionGroups === "object").toBe(true);
      expect(Object.keys(o.optionGroups!).length).toBeGreaterThan(0);
    });
  });

  it("getSpecialistOptions(registry, 'improve_agents_workflows') returns improve_agents_workflows option groups", () => {
    const options = getSpecialistOptions(reg, "improve_agents_workflows");
    expect(options).toHaveLength(1);
    expect(options[0].specialistId).toBe("improve_agents_workflows");
    const groups = options[0].optionGroups;
    expect(groups).toHaveProperty("observe");
    expect(groups).toHaveProperty("act_prompt");
    expect(groups).toHaveProperty("act_topology");
    expect(groups).toHaveProperty("act_training");
    expect(groups).toHaveProperty("evaluate");
    expect(groups!.observe.label).toBeDefined();
    expect(Array.isArray(groups!.observe.toolIds)).toBe(true);
    expect(groups!.observe.toolIds).toContain("get_run_for_improvement");
  });
});

describe("heap router", () => {
  const reg = getRegistry();

  it("buildRouterPrompt includes user message and specialist list", () => {
    const prompt = buildRouterPrompt("Create a workflow", reg);
    expect(prompt).toContain("Create a workflow");
    expect(prompt).toContain("general");
    expect(prompt).toContain("workflow");
    expect(prompt).toContain("priorityOrder");
    expect(prompt).toContain("refinedTask");
  });

  it("buildRouterPrompt with includeDescriptions: false omits descriptions", () => {
    const prompt = buildRouterPrompt("Hi", reg, { includeDescriptions: false });
    expect(prompt).toContain("- general\n");
    expect(prompt).not.toMatch(/general — .+Conversation/);
  });

  it("parseRouterOutput parses valid JSON with string steps", () => {
    const text = `{"priorityOrder": ["workflow", "general"], "refinedTask": "Create and run a workflow."}`;
    const out = parseRouterOutput(text);
    expect(out).not.toBeNull();
    expect(out!.priorityOrder).toEqual(["workflow", "general"]);
    expect(out!.refinedTask).toBe("Create and run a workflow.");
  });

  it("parseRouterOutput parses parallel steps", () => {
    const text = `Some preamble\n{"priorityOrder": [{"parallel": ["general", "workflow"]}], "refinedTask": "Do both."} trailing`;
    const out = parseRouterOutput(text);
    expect(out).not.toBeNull();
    expect(out!.priorityOrder).toHaveLength(1);
    expect(out!.priorityOrder[0]).toEqual({ parallel: ["general", "workflow"] });
    expect(out!.refinedTask).toBe("Do both.");
  });

  it("parseRouterOutput returns null for missing priorityOrder or refinedTask", () => {
    expect(parseRouterOutput('{"refinedTask": "x"}')).toBeNull();
    expect(parseRouterOutput('{"priorityOrder": []}')).toBeNull();
    expect(parseRouterOutput('{"priorityOrder": [], "refinedTask": 123}')).toBeNull();
  });

  it("parseRouterOutput returns null for non-JSON or invalid text", () => {
    expect(parseRouterOutput("")).toBeNull();
    expect(parseRouterOutput("no json here")).toBeNull();
    expect(parseRouterOutput("[]")).toBeNull();
  });

  it("parseRouterOutput filters non-string items in parallel", () => {
    const text = `{"priorityOrder": [{"parallel": ["a", 1, null, "b"]}], "refinedTask": "Task"}`;
    const out = parseRouterOutput(text);
    expect(out).not.toBeNull();
    expect(out!.priorityOrder[0]).toEqual({ parallel: ["a", "b"] });
  });
});

describe("heap planner", () => {
  const reg = getRegistry();

  it("buildPlannerPrompt includes user message, specialist list, and improver instruction keys", () => {
    const prompt = buildPlannerPrompt("Build an agent for LinkedIn", reg);
    expect(prompt).toContain("Build an agent for LinkedIn");
    expect(prompt).toContain("general");
    expect(prompt).toContain("priorityOrder");
    expect(prompt).toContain("extractedContext");
    expect(prompt).toContain("instructionsForGeneral");
    expect(prompt).toContain("instructionsForImproveRun");
    expect(prompt).toContain("instructionsForImproveHeap");
    expect(prompt).toContain("instructionsForImproveAgentsWorkflows");
  });

  it("buildPlannerPrompt includes improve_run, improve_heap, improve_agents_workflows and create-before-improve_agents_workflows rule", () => {
    const prompt = buildPlannerPrompt(
      "Create an agent and a workflow and add the agent to it and run it",
      reg
    );
    expect(prompt).toMatch(/improve_run|improve_heap|improve_agents_workflows/);
    expect(prompt).toMatch(
      /improve_agents_workflows.*cannot create|agent.*workflow.*before.*improve_agents_workflows/i
    );
    expect(prompt).toMatch(
      /put\s+["']agent["']\s+and\s+["']workflow["'].*before\s+["']improve_agents_workflows["']/i
    );
    expect(prompt).toMatch(/\[Created agent id:/);
  });

  it("parsePlanOutput parses valid JSON with all fields", () => {
    const text = `{"priorityOrder": ["general", "agent"], "refinedTask": "Create one agent.", "extractedContext": {"savedSearchUrl": "https://example.com/search?id=123"}, "instructionsForGeneral": "Do not ask for credentials."}`;
    const out = parsePlanOutput(text);
    expect(out).not.toBeNull();
    expect(out!.priorityOrder).toEqual(["general", "agent"]);
    expect(out!.refinedTask).toBe("Create one agent.");
    expect(out!.extractedContext).toEqual({ savedSearchUrl: "https://example.com/search?id=123" });
    expect(out!.instructionsForGeneral).toBe("Do not ask for credentials.");
  });

  it("parsePlanOutput parses parallel steps and preserves URLs in extractedContext", () => {
    const url = "https://www.linkedin.com/sales/search/people?savedSearchId=1962332737";
    const text = `{"priorityOrder": [{"parallel": ["agent", "workflow"]}], "refinedTask": "Build agent and workflow.", "extractedContext": {"savedSearchUrl": "${url}"}}`;
    const out = parsePlanOutput(text);
    expect(out).not.toBeNull();
    expect(out!.priorityOrder[0]).toEqual({ parallel: ["agent", "workflow"] });
    expect(out!.extractedContext?.savedSearchUrl).toBe(url);
  });

  it("parsePlanOutput parses instructionsForImproveRun and instructionsForImproveHeap and instructionsForImproveAgentsWorkflows", () => {
    const text = `{"priorityOrder": ["improve_run", "improve_heap", "improve_agents_workflows"], "refinedTask": "Suggest then persist.", "instructionsForImproveRun": "Observe runId from context; suggest; apply_session_override.", "instructionsForImproveHeap": "Register a new specialist.", "instructionsForImproveAgentsWorkflows": "Observe run, then act_prompt."}`;
    const out = parsePlanOutput(text);
    expect(out).not.toBeNull();
    expect(out!.priorityOrder).toEqual(["improve_run", "improve_heap", "improve_agents_workflows"]);
    expect(out!.instructionsForImproveRun).toBe(
      "Observe runId from context; suggest; apply_session_override."
    );
    expect(out!.instructionsForImproveHeap).toBe("Register a new specialist.");
    expect(out!.instructionsForImproveAgentsWorkflows).toBe("Observe run, then act_prompt.");
  });

  it("parsePlanOutput maps legacy instructionsForImprovement* to new keys for backward compat", () => {
    const text = `{"priorityOrder": ["improvement_session", "improvement_heap"], "refinedTask": "Suggest.", "instructionsForImprovementSession": "Suggest only.", "instructionsForImprovementHeap": "Register specialist."}`;
    const out = parsePlanOutput(text);
    expect(out).not.toBeNull();
    expect(out!.instructionsForImproveRun).toBe("Suggest only.");
    expect(out!.instructionsForImproveHeap).toBe("Register specialist.");
  });

  it("parsePlanOutput returns null for missing priorityOrder or refinedTask", () => {
    expect(parsePlanOutput('{"refinedTask": "x"}')).toBeNull();
    expect(parsePlanOutput('{"priorityOrder": []}')).toBeNull();
    expect(parsePlanOutput('{"priorityOrder": [], "refinedTask": 123}')).toBeNull();
  });

  it("parsePlanOutput returns null for non-JSON or invalid text", () => {
    expect(parsePlanOutput("")).toBeNull();
    expect(parsePlanOutput("no json")).toBeNull();
  });

  it("enrichTaskWithPlan appends instruction and extractedContext", () => {
    const plan = {
      priorityOrder: ["general", "agent"] as HeapStep[],
      refinedTask: "Create an agent.",
      extractedContext: { savedSearchUrl: "https://example.com" },
      instructionsForGeneral: "Do not ask for credentials.",
    };
    const task = enrichTaskWithPlan(plan.refinedTask, "general", plan);
    expect(task).toContain("Create an agent.");
    expect(task).toContain("Plan for you:");
    expect(task).toContain("Do not ask for credentials.");
    expect(task).toContain("Extracted context");
    expect(task).toContain("https://example.com");
  });

  it("enrichTaskWithPlan with previousSteps includes them", () => {
    const plan = {
      priorityOrder: ["agent"] as HeapStep[],
      refinedTask: "Create agent.",
    };
    const task = enrichTaskWithPlan(plan.refinedTask, "agent", plan, "general: Done.");
    expect(task).toContain("Previous steps:");
    expect(task).toContain("general: Done.");
  });

  it("PLANNER_RETRY_INSTRUCTION is non-empty and mentions JSON", () => {
    expect(PLANNER_RETRY_INSTRUCTION.length).toBeGreaterThan(0);
    expect(PLANNER_RETRY_INSTRUCTION.toLowerCase()).toContain("json");
  });

  it("inferFallbackPriorityOrder returns agent when message mentions create agent", () => {
    const reg = getRegistry();
    const order = inferFallbackPriorityOrder(
      "Can you create an agent for LinkedIn?",
      undefined,
      reg
    );
    expect(order).toContain("agent");
  });

  it("inferFallbackPriorityOrder returns workflow when message mentions run the workflow", () => {
    const reg = getRegistry();
    const order = inferFallbackPriorityOrder("run the workflow now", undefined, reg);
    expect(order).toContain("workflow");
  });

  it("inferFallbackPriorityOrder returns agent and workflow when message mentions both create agent and run workflow", () => {
    const reg = getRegistry();
    const order = inferFallbackPriorityOrder(
      "Create an agent and run the workflow now",
      undefined,
      reg
    );
    expect(order).toContain("agent");
    expect(order).toContain("workflow");
  });

  it("inferFallbackPriorityOrder uses recentContext for intent", () => {
    const reg = getRegistry();
    const order = inferFallbackPriorityOrder(
      "yes",
      "user wanted to create an agent and run the workflow",
      reg
    );
    expect(order).toContain("agent");
    expect(order).toContain("workflow");
  });

  it("inferFallbackPriorityOrder returns first top-level id when no create/run keywords", () => {
    const reg = getRegistry();
    const order = inferFallbackPriorityOrder("just say hello", undefined, reg);
    expect(Array.isArray(order)).toBe(true);
    expect(order.length).toBe(1);
    expect(reg.topLevelIds).toContain(order[0]);
  });

  it("inferFallbackPriorityOrder returns empty when registry has no top-level ids", () => {
    const reg: SpecialistRegistry = { topLevelIds: [], specialists: {} };
    const order = inferFallbackPriorityOrder("create an agent", undefined, reg);
    expect(order).toEqual([]);
  });

  it("buildPlannerContinuationPrompt includes previous plan and user reply", () => {
    const reg = getRegistry();
    const previousPlan = {
      priorityOrder: ["agent", "workflow"] as HeapStep[],
      refinedTask: "Create agent and workflow.",
      extractedContext: { savedSearchUrl: "https://example.com/search" },
    };
    const prompt = buildPlannerContinuationPrompt(
      previousPlan,
      "Create the agent + workflow, use vault credentials, and run the workflow now",
      reg
    );
    expect(prompt).toContain("continuing from the previous turn");
    expect(prompt).toContain("Create the agent + workflow");
    expect(prompt).toContain("https://example.com/search");
    expect(prompt).toContain("priorityOrder");
    expect(prompt).toContain("updated");
    expect(prompt).toContain("output an **updated** plan");
  });

  it("buildPlannerContinuationPrompt output is parseable by parsePlanOutput when LLM returns valid JSON", () => {
    const reg = getRegistry();
    const previousPlan = {
      priorityOrder: ["agent"] as HeapStep[],
      refinedTask: "Create one agent.",
      extractedContext: { savedSearchId: "123" },
    };
    const prompt = buildPlannerContinuationPrompt(previousPlan, "Run with defaults now", reg);
    expect(prompt.length).toBeGreaterThan(100);
    const mockUpdatedPlan = `{"priorityOrder": ["agent", "workflow"], "refinedTask": "User confirmed. Create agent and workflow, then run."}`;
    const parsed = parsePlanOutput(mockUpdatedPlan);
    expect(parsed).not.toBeNull();
    expect(parsed!.priorityOrder).toEqual(["agent", "workflow"]);
    expect(parsed!.refinedTask).toContain("User confirmed");
  });
});

describe("mergePlanOnImprovementTypeConfirmation", () => {
  const createAgentWorkflowPlan = {
    priorityOrder: ["agent", "workflow"] as HeapStep[],
    refinedTask: "Create a self-improving agent and add it to a new workflow.",
    extractedContext: { savedSearchId: "1962332737" },
    instructionsForAgent:
      "Create an agent (suggested name: 'LinkedIn-KW-SelfLearner') with the following spec: ...",
    instructionsForWorkflow:
      "Create a new workflow (suggested name: 'LinkedInKeywordCollection_and_SelfLearning') ...",
  };

  it("returns merged plan with prompt_and_workflow_only when user confirms option 1", () => {
    const merged = mergePlanOnImprovementTypeConfirmation(
      createAgentWorkflowPlan,
      "1 — Prompt and workflow only (recommended)"
    );
    expect(merged).not.toBeNull();
    expect(merged!.extractedContext?.selfImprovementType).toBe("prompt_and_workflow_only");
    expect(merged!.refinedTask).toBe(createAgentWorkflowPlan.refinedTask);
    expect(merged!.instructionsForAgent).toBe(createAgentWorkflowPlan.instructionsForAgent);
    expect(merged!.instructionsForWorkflow).toBe(createAgentWorkflowPlan.instructionsForWorkflow);
  });

  it("returns merged plan with model_training when user confirms option 2", () => {
    const merged = mergePlanOnImprovementTypeConfirmation(
      createAgentWorkflowPlan,
      "Also model training"
    );
    expect(merged).not.toBeNull();
    expect(merged!.extractedContext?.selfImprovementType).toBe("model_training");
  });

  it("returns null when user reply is not a known confirmation", () => {
    const merged = mergePlanOnImprovementTypeConfirmation(
      createAgentWorkflowPlan,
      "something random"
    );
    expect(merged).toBeNull();
  });

  it("returns null when previous plan does not imply create agent and workflow", () => {
    const workflowOnlyPlan = {
      priorityOrder: ["workflow"] as HeapStep[],
      refinedTask: "Run workflow.",
      extractedContext: { requestedActions: ["execute_workflow_on_demand"] },
    };
    const merged = mergePlanOnImprovementTypeConfirmation(
      workflowOnlyPlan,
      "1 — Prompt and workflow only (recommended)"
    );
    expect(merged).toBeNull();
  });
});

describe("planImpliesCreateAgentAndWorkflow and reorderAgentBeforeWorkflow", () => {
  it("planImpliesCreateAgentAndWorkflow returns true when extractedContext.requestedActions has create_workflow and create_agent", () => {
    expect(
      planImpliesCreateAgentAndWorkflow({
        priorityOrder: ["workflow", "agent"],
        refinedTask: "Create both.",
        extractedContext: {
          requestedActions: [
            "create_agent_with_self_improvement",
            "create_workflow",
            "add_agent_to_workflow",
          ],
        },
      })
    ).toBe(true);
  });

  it("planImpliesCreateAgentAndWorkflow returns true when instructions mention creating agent and workflow", () => {
    expect(
      planImpliesCreateAgentAndWorkflow({
        priorityOrder: ["agent", "workflow"],
        refinedTask: "Create both.",
        instructionsForAgent: "Create an agent (default name 'X').",
        instructionsForWorkflow: "Create a new workflow and add the agent.",
      })
    ).toBe(true);
  });

  it("planImpliesCreateAgentAndWorkflow returns false when plan is null", () => {
    expect(planImpliesCreateAgentAndWorkflow(null)).toBe(false);
  });

  it("planImpliesCreateAgentAndWorkflow returns false when only workflow is requested", () => {
    expect(
      planImpliesCreateAgentAndWorkflow({
        priorityOrder: ["workflow"],
        refinedTask: "Run workflow.",
        extractedContext: { requestedActions: ["execute_workflow_on_demand"] },
      })
    ).toBe(false);
  });

  it("reorderAgentBeforeWorkflow moves agent before workflow when workflow was first", () => {
    const order: HeapStep[] = [
      "improve_agents_workflows__part1",
      "workflow__part1",
      "agent",
      "general",
    ];
    const reordered = reorderAgentBeforeWorkflow(order);
    const flat = reordered.map((s) => (typeof s === "string" ? s : s.parallel[0]));
    const agentIdx = flat.findIndex((id) => id === "agent" || id.startsWith("agent__"));
    const workflowIdx = flat.findIndex((id) => id === "workflow" || id.startsWith("workflow__"));
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(workflowIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeLessThan(workflowIdx);
    expect(flat).toContain("improve_agents_workflows__part1");
    expect(flat).toContain("general");
    expect(flat).toHaveLength(4);
  });

  it("reorderAgentBeforeWorkflow leaves order unchanged when agent already before workflow", () => {
    const order: HeapStep[] = ["improve_agents_workflows", "agent", "workflow", "general"];
    const reordered = reorderAgentBeforeWorkflow(order);
    expect(reordered).toEqual(order);
  });

  it("isImproveAgentsWorkflowsId returns true for improve_agents_workflows and parts", () => {
    expect(isImproveAgentsWorkflowsId("improve_agents_workflows")).toBe(true);
    expect(isImproveAgentsWorkflowsId("improve_agents_workflows__part1")).toBe(true);
    expect(isImproveAgentsWorkflowsId("improve_run")).toBe(false);
    expect(isImproveAgentsWorkflowsId("improve_heap")).toBe(false);
  });

  it("reorderAgentAndWorkflowBeforeImproveAgentsWorkflows puts agent and workflow before improve_agents_workflows when create-both", () => {
    const order: HeapStep[] = [
      "improve_agents_workflows__part1",
      "agent",
      "workflow__part1",
      "general",
    ];
    const reordered = reorderAgentAndWorkflowBeforeImproveAgentsWorkflows(order);
    const flat = reordered.map((s) => (typeof s === "string" ? s : s.parallel[0]));
    const agentIdx = flat.findIndex((id) => id === "agent" || id.startsWith("agent__"));
    const workflowIdx = flat.findIndex((id) => id === "workflow" || id.startsWith("workflow__"));
    const improveIdx = flat.findIndex((id) => isImproveAgentsWorkflowsId(id));
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(workflowIdx).toBeGreaterThanOrEqual(0);
    expect(improveIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeLessThan(improveIdx);
    expect(workflowIdx).toBeLessThan(improveIdx);
    expect(flat).toEqual([
      "agent",
      "workflow__part1",
      "improve_agents_workflows__part1",
      "general",
    ]);
  });

  it("reorderAgentBeforeWorkflow leaves order unchanged when only workflow or only agent", () => {
    expect(reorderAgentBeforeWorkflow(["workflow", "general"])).toEqual(["workflow", "general"]);
    expect(reorderAgentBeforeWorkflow(["agent", "general"])).toEqual(["agent", "general"]);
  });
});

describe("heap DAG construction", () => {
  const registry: SpecialistRegistry = {
    topLevelIds: ["a", "b", "c"],
    specialists: {
      a: { id: "a", toolNames: [] },
      b: { id: "b", toolNames: [] },
      c: { id: "c", toolNames: [] },
    },
  };

  it("buildHeapDAG converts sequential steps to one level per step", () => {
    const dag = buildHeapDAG(["a", "b", "c"], registry);
    expect(dag.levels).toHaveLength(3);
    expect(dag.levels[0]).toEqual(["a"]);
    expect(dag.levels[1]).toEqual(["b"]);
    expect(dag.levels[2]).toEqual(["c"]);
  });

  it("buildHeapDAG converts parallel step to one level with multiple ids", () => {
    const dag = buildHeapDAG([{ parallel: ["a", "b"] }], registry);
    expect(dag.levels).toHaveLength(1);
    expect(dag.levels[0]).toEqual(["a", "b"]);
  });

  it("buildHeapDAG mixes sequential and parallel", () => {
    const dag = buildHeapDAG(["a", { parallel: ["b", "c"] }, "a"], registry);
    expect(dag.levels).toHaveLength(3);
    expect(dag.levels[0]).toEqual(["a"]);
    expect(dag.levels[1]).toEqual(["b", "c"]);
    expect(dag.levels[2]).toEqual(["a"]);
  });

  it("buildHeapDAG strips unknown ids and drops empty steps", () => {
    const dag = buildHeapDAG(["a", "unknown", "b", { parallel: ["x", "b"] }], registry);
    expect(dag.levels).toHaveLength(3);
    expect(dag.levels[0]).toEqual(["a"]);
    expect(dag.levels[1]).toEqual(["b"]);
    expect(dag.levels[2]).toEqual(["b"]);
  });

  it("buildHeapDAG is pure and deterministic (no LLM)", () => {
    const priorityOrder = ["a", { parallel: ["b", "c"] }];
    const dag1 = buildHeapDAG(priorityOrder, registry);
    const dag2 = buildHeapDAG(priorityOrder, registry);
    expect(dag1).toEqual(dag2);
    expect(dag1.levels).toEqual([["a"], ["b", "c"]]);
  });

  it("buildHeapDAG returns empty levels for empty priorityOrder", () => {
    const dag = buildHeapDAG([], registry);
    expect(dag.levels).toEqual([]);
  });

  it("buildHeapDAG with default registry works for route including subspecialists", () => {
    const reg = getRegistry();
    const dag = buildHeapDAG(["general", "improve_run", "agent"], reg);
    expect(dag.levels).toHaveLength(3);
    expect(dag.levels[0]).toEqual(["general"]);
    expect(dag.levels[1]).toEqual(["improve_run"]);
    expect(dag.levels[2]).toEqual(["agent"]);
  });

  it("runHeapFromDAG executes same as runHeap for same route", async () => {
    const priorityOrder: (string | { parallel: string[] })[] = ["a", { parallel: ["b", "c"] }, "a"];
    const dag = buildHeapDAG(priorityOrder, registry);
    const runSpecialist = async (id: string) => ({ summary: id });
    const fromDag = await runHeapFromDAG(dag, "Task", runSpecialist, registry);
    const fromRoute = await runHeap(priorityOrder, "Task", runSpecialist, registry);
    expect(fromDag.summary).toBe(fromRoute.summary);
    expect(fromDag.context.steps.map((s) => s.specialistId)).toEqual(
      fromRoute.context.steps.map((s) => s.specialistId)
    );
  });
});

describe("heap runner", () => {
  const registry: SpecialistRegistry = {
    topLevelIds: ["a", "b", "c"],
    specialists: {
      a: { id: "a", toolNames: ["t1"] },
      b: { id: "b", toolNames: ["t2"] },
      c: { id: "c", toolNames: ["t3"] },
    },
  };

  it("runs sequential steps in order and returns last summary", async () => {
    const run = await runHeap(
      ["a", "b"],
      "Do task",
      async (id, task, context) => ({ summary: `${id}:${task}` }),
      registry
    );
    expect(run.summary).toBe("b:Do task");
    expect(run.context.steps).toHaveLength(2);
    expect(run.context.steps[0]).toEqual({ specialistId: "a", outcome: "a:Do task" });
    expect(run.context.steps[1]).toEqual({ specialistId: "b", outcome: "b:Do task" });
  });

  it("runs parallel step and merges outcomes", async () => {
    const run = await runHeap(
      [{ parallel: ["a", "b"] }],
      "Parallel task",
      async (id) => ({ summary: `done-${id}` }),
      registry
    );
    expect(run.summary).toBe("done-b");
    expect(run.context.steps).toHaveLength(2);
  });

  it("strips unknown step ids and runs only known", async () => {
    const calls: string[] = [];
    const run = await runHeap(
      ["a", "unknown", "b"],
      "Task",
      async (id) => {
        calls.push(id);
        return { summary: id };
      },
      registry
    );
    expect(calls).toEqual(["a", "b"]);
    expect(run.summary).toBe("b");
  });

  it("empty priorityOrder uses fallback specialist", async () => {
    const run = await runHeap([], "Task", async (id) => ({ summary: `fallback-${id}` }), registry);
    expect(run.summary).toBe("fallback-a");
    expect(run.context.steps).toHaveLength(1);
    expect(run.context.steps[0].specialistId).toBe("a");
  });

  it("empty priorityOrder with no topLevelIds returns no specialists message", async () => {
    const emptyReg: SpecialistRegistry = { topLevelIds: [], specialists: {} };
    const run = await runHeap([], "Task", async () => ({ summary: "x" }), emptyReg);
    expect(run.summary).toBe("No specialists available.");
    expect(run.context.steps).toEqual([]);
  });

  it("delegateHeap runs sub-heap then continues", async () => {
    const order: string[] = [];
    const run = await runHeap(
      ["a", "b"],
      "Main",
      async (id, task) => {
        order.push(id);
        if (id === "a") {
          return { summary: "a-done", delegateHeap: ["c"], delegateTask: "Sub" };
        }
        return { summary: `${id}-done` };
      },
      registry
    );
    expect(order).toEqual(["a", "c", "b"]);
    expect(run.summary).toBe("b-done");
  });

  it("delegateHeap respects depth limit 2", async () => {
    const depthLimit = 2;
    const run = await runHeap(
      ["a"],
      "Task",
      async () => ({ summary: "delegate", delegateHeap: ["a"] }),
      registry,
      { depthLimit }
    );
    expect(run.summary).toBe("delegate");
  });

  it("delegateHeap respects depth limit 5 (default)", async () => {
    const calls: number[] = [];
    const run = await runHeap(
      ["a"],
      "Task",
      async (_, __, context) => {
        const depth = context.steps.length;
        calls.push(depth);
        if (depth < DEFAULT_HEAP_DEPTH_LIMIT) {
          return { summary: "delegate", delegateHeap: ["a"] };
        }
        return { summary: "done" };
      },
      registry,
      { depthLimit: DEFAULT_HEAP_DEPTH_LIMIT }
    );
    expect(calls).toHaveLength(DEFAULT_HEAP_DEPTH_LIMIT + 1);
    expect(calls).toEqual([0, 1, 2, 3, 4, 5]);
    expect(run.summary).toBe("done");
  });
});

/** Builds a registry that is a single chain of depth 5: s0 -> s1 -> s2 -> s3 -> s4 -> s5 (6 nodes). */
function buildDepth5ChainRegistry(): SpecialistRegistry {
  const specialists: Record<string, SpecialistEntry> = {};
  const ids = ["s0", "s1", "s2", "s3", "s4", "s5"];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const next = i < ids.length - 1 ? [ids[i + 1]] : undefined;
    specialists[id] = { id, toolNames: [`tool_${id}`], delegateTargets: next };
  }
  return { topLevelIds: ["s0"], specialists };
}

describe("heap search and options (recursive, depth 5)", () => {
  const DEPTH_LIMIT = 5;

  /** Complexity: path search is O(depthLimit × |topLevelIds|); with fixed depth this is O(n). */
  it("getOptionsAtNode returns at most HEAP_OPTIONS_CAP options at each level", () => {
    const reg = buildDepth5ChainRegistry();
    expect(getOptionsAtNode(reg, null)).toEqual(["s0"]);
    expect(getOptionsAtNode(reg, "s0")).toEqual(["s1"]);
    expect(getOptionsAtNode(reg, "s1")).toEqual(["s2"]);
    expect(getOptionsAtNode(reg, "s5")).toEqual([]);
    getOptionsAtNode(reg, null, 10).forEach((id) => expect(reg.specialists[id]).toBeDefined());
  });

  it("searchHeapPath finds path to depth 5 with mocked choose (deterministic, no LLM)", () => {
    const reg = buildDepth5ChainRegistry();
    const pathToLeaf = ["s0", "s1", "s2", "s3", "s4", "s5"];
    const choose: ChooseFn = (options) => (options.length > 0 ? options[0] : null);
    const path = searchHeapPath(reg, DEPTH_LIMIT, choose);
    expect(path).toHaveLength(6);
    expect(path).toEqual(pathToLeaf);
    expect(path[5]).toBe("s5");
  });

  it("searchHeapPath stops at depth limit and never exposes more than HEAP_OPTIONS_CAP options", () => {
    const reg = buildDepth5ChainRegistry();
    let maxOptionsSeen = 0;
    const choose: ChooseFn = (options) => {
      maxOptionsSeen = Math.max(maxOptionsSeen, options.length);
      return options.length > 0 ? options[0] : null;
    };
    searchHeapPath(reg, DEPTH_LIMIT, choose);
    expect(maxOptionsSeen).toBeLessThanOrEqual(HEAP_OPTIONS_CAP);
  });

  it("runHeap delegation chain reaches depth 5 (deterministic, no LLM)", async () => {
    const reg = buildDepth5ChainRegistry();
    const order: string[] = [];
    const run = await runHeap(
      ["s0"],
      "Task",
      async (id) => {
        order.push(id);
        const entry = reg.specialists[id];
        const next = entry?.delegateTargets?.[0];
        if (next) {
          return { summary: `${id}-delegated`, delegateHeap: [next] };
        }
        return { summary: `leaf-${id}` };
      },
      reg,
      { depthLimit: DEPTH_LIMIT }
    );
    expect(order).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    expect(run.summary).toBe("leaf-s5");
    expect(run.context.steps).toHaveLength(6);
  });
});
