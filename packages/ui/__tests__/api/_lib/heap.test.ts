import { describe, it, expect } from "vitest";
import {
  getRegistry,
  applyRegistryCaps,
  SPECIALIST_TOOL_CAP,
  TOP_LEVEL_CAP,
  DELEGATE_TARGETS_CAP,
  buildRouterPrompt,
  parseRouterOutput,
  buildHeapDAG,
  runHeap,
  runHeapFromDAG,
  DEFAULT_HEAP_DEPTH_LIMIT,
} from "@agentron-studio/runtime";
import type { SpecialistRegistry } from "@agentron-studio/runtime";

describe("heap registry", () => {
  it("getRegistry() returns default registry with expected top-level ids and specialists", () => {
    const reg = getRegistry();
    expect(reg.topLevelIds).toEqual(["general", "workflow", "improvement", "agent"]);
    expect(Object.keys(reg.specialists)).toEqual(["general", "workflow", "improvement", "agent"]);
    expect(reg.specialists.general?.toolNames.length).toBeLessThanOrEqual(SPECIALIST_TOOL_CAP);
    expect(reg.specialists.workflow?.toolNames).toContain("execute_workflow");
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

  it("runHeapFromDAG executes same as runHeap for same route", async () => {
    const priorityOrder: (string | { parallel: string[] })[] = ["a", { parallel: ["b", "c"] }, "a"];
    const dag = buildHeapDAG(priorityOrder, registry);
    const runSpecialist = async (id: string) => ({ summary: id });
    const fromDag = await runHeapFromDAG(dag, "Task", runSpecialist, registry);
    const fromRoute = await runHeap(priorityOrder, "Task", runSpecialist, registry);
    expect(fromDag.summary).toBe(fromRoute.summary);
    expect(fromDag.context.steps.map((s) => s.specialistId)).toEqual(fromRoute.context.steps.map((s) => s.specialistId));
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
    const run = await runHeap(
      [],
      "Task",
      async (id) => ({ summary: `fallback-${id}` }),
      registry
    );
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
