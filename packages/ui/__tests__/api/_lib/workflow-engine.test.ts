import { describe, it, expect } from "vitest";
import {
  WorkflowEngine,
  buildWorkflowDAGFromNodes,
  runWorkflowDAGLevels,
  executionOrderToLevels,
  SharedContextManager,
} from "@agentron-studio/runtime";

describe("workflow DAG helpers", () => {
  it("buildWorkflowDAGFromNodes creates one level per node in order when no executionOrder", () => {
    const workflow: any = {
      nodes: [
        { id: "n1", type: "mock", parameters: {} },
        { id: "n2", type: "mock", parameters: {} },
      ],
      edges: [],
    };

    const levels = buildWorkflowDAGFromNodes(workflow);
    expect(levels).toEqual([["n1"], ["n2"]]);
  });

  it("buildWorkflowDAGFromNodes uses executionOrder when present (parallel grouping)", () => {
    const workflow: any = {
      nodes: [
        { id: "a", type: "mock", parameters: {} },
        { id: "b", type: "mock", parameters: {} },
        { id: "c", type: "mock", parameters: {} },
      ],
      edges: [],
      executionOrder: ["a", { parallel: ["b", "c"] }],
    };

    const levels = buildWorkflowDAGFromNodes(workflow);
    expect(levels).toEqual([["a"], ["b", "c"]]);
  });

  it("executionOrderToLevels strips unknown node ids", () => {
    const workflow: any = {
      nodes: [{ id: "x", type: "mock", parameters: {} }],
      edges: [],
    };
    const levels = executionOrderToLevels(["x", "unknown", { parallel: ["y", "x"] }], workflow);
    expect(levels).toEqual([["x"], ["x"]]);
  });

  it("runWorkflowDAGLevels executes nodes in level order and returns last output", async () => {
    const workflow: any = {
      nodes: [
        { id: "n1", type: "mock", parameters: { value: 1 } },
        { id: "n2", type: "mock", parameters: { value: 2 } },
      ],
      edges: [],
    };

    const seen: string[] = [];
    const handlers: any = {
      mock: async (nodeId: string, config: any, ctx: SharedContextManager) => {
        seen.push(nodeId);
        const v = config?.value ?? 0;
        ctx.set(nodeId, v);
        return v;
      },
    };

    const levels = buildWorkflowDAGFromNodes(workflow);
    const result = await runWorkflowDAGLevels(levels, workflow, handlers);

    expect(seen).toEqual(["n1", "n2"]);
    expect(result.output).toBe(2);
    expect(result.context["n1"]).toBe(1);
    expect(result.context["n2"]).toBe(2);
  });

  it("runWorkflowDAGLevels runs nodes in a level in parallel", async () => {
    const workflow: any = {
      nodes: [
        { id: "first", type: "mock", parameters: { v: "a" } },
        { id: "p1", type: "mock", parameters: { v: "b" } },
        { id: "p2", type: "mock", parameters: { v: "c" } },
        { id: "last", type: "mock", parameters: { v: "d" } },
      ],
      edges: [],
      executionOrder: ["first", { parallel: ["p1", "p2"] }, "last"],
    };

    const order: string[] = [];
    const handlers: any = {
      mock: async (nodeId: string, config: any, ctx: SharedContextManager) => {
        order.push(nodeId);
        const v = config?.v ?? "";
        ctx.set(nodeId, v);
        return v;
      },
    };

    const levels = buildWorkflowDAGFromNodes(workflow);
    expect(levels).toEqual([["first"], ["p1", "p2"], ["last"]]);

    const result = await runWorkflowDAGLevels(levels, workflow, handlers);

    expect(result.context["first"]).toBe("a");
    expect(result.context["p1"]).toBe("b");
    expect(result.context["p2"]).toBe("c");
    expect(result.context["last"]).toBe("d");
    expect(result.output).toBe("d");
    expect(order).toContain("first");
    expect(order).toContain("p1");
    expect(order).toContain("p2");
    expect(order).toContain("last");
    expect(order.indexOf("first")).toBeLessThan(Math.min(order.indexOf("p1"), order.indexOf("p2")));
    expect(Math.max(order.indexOf("p1"), order.indexOf("p2"))).toBeLessThan(order.indexOf("last"));
  });
});

describe("WorkflowEngine execute", () => {
  it("uses leveled DAG execution for linear workflows", async () => {
    const workflow: any = {
      nodes: [
        { id: "first", type: "mock", parameters: { v: "a" } },
        { id: "second", type: "mock", parameters: { v: "b" } },
      ],
      edges: [],
    };

    const calls: string[] = [];
    const handlers: any = {
      mock: async (nodeId: string, config: any, ctx: SharedContextManager) => {
        calls.push(nodeId);
        const value = config?.v ?? "";
        ctx.set(nodeId, value);
        return value;
      },
    };

    const engine = new WorkflowEngine();
    const result = await engine.execute(workflow, handlers);

    expect(calls).toEqual(["first", "second"]);
    expect(result.output).toBe("b");
    expect(result.context["first"]).toBe("a");
    expect(result.context["second"]).toBe("b");
  });

  it("respects executionOrder with parallel grouping", async () => {
    const workflow: any = {
      nodes: [
        { id: "seq", type: "mock", parameters: { v: 1 } },
        { id: "pa", type: "mock", parameters: { v: 2 } },
        { id: "pb", type: "mock", parameters: { v: 3 } },
      ],
      edges: [],
      executionOrder: ["seq", { parallel: ["pa", "pb"] }],
    };

    const handlers: any = {
      mock: async (nodeId: string, config: any, ctx: SharedContextManager) => {
        const v = config?.v;
        ctx.set(nodeId, v);
        return v;
      },
    };

    const engine = new WorkflowEngine();
    const result = await engine.execute(workflow, handlers);

    expect(result.context["seq"]).toBe(1);
    expect(result.context["pa"]).toBe(2);
    expect(result.context["pb"]).toBe(3);
    expect(result.output).toBe(3);
  });
});
