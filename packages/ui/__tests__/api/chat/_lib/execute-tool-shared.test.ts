import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContainerCreate = vi.fn().mockResolvedValue("mock-container-id");
const mockAppendLogLine = vi.fn();
vi.mock("../../../../app/api/_lib/container-manager", () => ({
  getContainerManager: () => ({ create: mockContainerCreate }),
}));
vi.mock("../../../../app/api/_lib/api-logger", () => ({
  appendLogLine: (...args: unknown[]) => mockAppendLogLine(...args),
}));

import {
  resolveWorkflowIdFromArgs,
  ensureLlmNodesHaveSystemPrompt,
  ensureToolNodesInGraph,
  resolveLearningConfig,
  getNested,
  resolveTemplateVars,
  applyAgentGraphLayout,
  enrichAgentToolResult,
  ensureRunnerSandboxId,
  deriveFeedbackFromExecutionHistory,
  logToolPhase,
  logToolSuccessAndReturn,
} from "../../../../app/api/chat/_lib/execute-tool-shared";
import {
  db,
  tools,
  toToolRow,
  sandboxes,
  toSandboxRow,
  toExecutionRow,
} from "../../../../app/api/_lib/db";
import { workflows, executions } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

describe("execute-tool-shared", () => {
  describe("applyAgentGraphLayout", () => {
    it("returns empty array unchanged", () => {
      expect(applyAgentGraphLayout([], [])).toEqual([]);
    });

    it("ensureToolNodesInGraph returns early when toolIds empty", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "n1", type: "llm", position: [0, 0], parameters: {} }];
      const edges: { id: string; source: string; target: string }[] = [];
      ensureToolNodesInGraph(nodes, edges, []);
      expect(nodes).toHaveLength(1);
      expect(edges).toHaveLength(0);
    });

    it("ensureToolNodesInGraph adds tool nodes when toolIds provided and not in graph", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "llm1", type: "llm", position: [0, 0], parameters: {} }];
      const edges: { id: string; source: string; target: string }[] = [];
      ensureToolNodesInGraph(nodes, edges, ["tool-a"]);
      expect(nodes.length).toBeGreaterThan(1);
      const toolNode = nodes.find((n) => n.type === "tool");
      expect(toolNode?.parameters).toEqual({ toolId: "tool-a" });
      expect(edges.some((e) => e.source === "llm1")).toBe(true);
    });

    it("ensureToolNodesInGraph treats tool node with non-string toolId as missing and adds requested toolIds", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [
        { id: "llm1", type: "llm", position: [0, 0], parameters: {} },
        {
          id: "t-x",
          type: "tool",
          position: [0, 0],
          parameters: { toolId: 123 as unknown as string },
        },
      ];
      const edges: { id: string; source: string; target: string }[] = [];
      ensureToolNodesInGraph(nodes, edges, ["tool-a"]);
      const toolNodes = nodes.filter((n) => n.type === "tool");
      expect(toolNodes.some((n) => (n.parameters as { toolId?: string }).toolId === "tool-a")).toBe(
        true
      );
    });

    it("ensureToolNodesInGraph does not add nodes when all toolIds already in graph", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [
        { id: "llm1", type: "llm", position: [0, 0], parameters: {} },
        { id: "t-a", type: "tool", position: [100, 0], parameters: { toolId: "tool-a" } },
      ];
      const edges: { id: string; source: string; target: string }[] = [];
      const lenBefore = nodes.length;
      ensureToolNodesInGraph(nodes, edges, ["tool-a"]);
      expect(nodes.length).toBe(lenBefore);
    });

    it("lays out nodes and returns new positions", () => {
      const nodes = [
        { id: "a", type: "llm", position: [0, 0] as [number, number] },
        { id: "b", type: "tool", position: [0, 0] as [number, number] },
      ];
      const edges = [{ id: "e1", source: "a", target: "b" }];
      const out = applyAgentGraphLayout(nodes, edges);
      expect(out).toHaveLength(2);
      expect(out.map((n) => n.position)).not.toEqual([
        [0, 0],
        [0, 0],
      ]);
    });
  });

  describe("ensureLlmNodesHaveSystemPrompt", () => {
    it("uses default prompt when fallback is undefined", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "n1", type: "llm", position: [0, 0], parameters: {} }];
      ensureLlmNodesHaveSystemPrompt(nodes, undefined);
      expect(nodes[0].parameters?.systemPrompt).toContain("helpful assistant");
    });

    it("uses default when fallback is empty or whitespace", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "n1", type: "llm", position: [0, 0], parameters: {} }];
      ensureLlmNodesHaveSystemPrompt(nodes, "   ");
      expect(nodes[0].parameters?.systemPrompt).toContain("helpful assistant");
    });

    it("uses fallback when non-empty string", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "n1", type: "llm", position: [0, 0], parameters: {} }];
      ensureLlmNodesHaveSystemPrompt(nodes, " Custom system prompt ");
      expect(nodes[0].parameters?.systemPrompt).toBe("Custom system prompt");
    });

    it("skips non-llm nodes", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "n1", type: "tool", position: [0, 0], parameters: {} }];
      ensureLlmNodesHaveSystemPrompt(nodes, "Prompt");
      expect(nodes[0].parameters?.systemPrompt).toBeUndefined();
    });

    it("sets systemPrompt when parameters missing", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [{ id: "n1", type: "llm", position: [0, 0] }];
      ensureLlmNodesHaveSystemPrompt(nodes, "P");
      expect(nodes[0].parameters).toBeDefined();
      expect(nodes[0].parameters?.systemPrompt).toBe("P");
    });

    it("replaces empty or whitespace current prompt", () => {
      const nodes: {
        id: string;
        type?: string;
        position: [number, number];
        parameters?: Record<string, unknown>;
      }[] = [
        {
          id: "n1",
          type: "llm",
          position: [0, 0],
          parameters: { systemPrompt: "   " },
        },
      ];
      ensureLlmNodesHaveSystemPrompt(nodes, "New");
      expect(nodes[0].parameters?.systemPrompt).toBe("New");
    });

    it("leaves non-empty current prompt unchanged", () => {
      const nodes = [
        {
          id: "n1",
          type: "llm",
          position: [0, 0] as [number, number],
          parameters: { systemPrompt: "Existing" },
        },
      ];
      ensureLlmNodesHaveSystemPrompt(nodes, "Fallback");
      expect(nodes[0].parameters?.systemPrompt).toBe("Existing");
    });
  });

  describe("resolveLearningConfig", () => {
    it("returns defaults when agent and toolArgs empty", () => {
      const out = resolveLearningConfig(undefined, {});
      expect(out.maxDerivedGood).toBe(20);
      expect(out.maxDerivedBad).toBe(20);
      expect(out.minCombinedFeedback).toBe(1);
      expect(out.recentExecutionsLimit).toBe(50);
    });

    it("uses agent learningConfig when toolArgs not set", () => {
      const agent = {
        learningConfig: {
          maxDerivedGood: 5,
          maxDerivedBad: 10,
          minCombinedFeedback: 2,
          recentExecutionsLimit: 30,
        },
      };
      const out = resolveLearningConfig(agent, {});
      expect(out.maxDerivedGood).toBe(5);
      expect(out.maxDerivedBad).toBe(10);
      expect(out.minCombinedFeedback).toBe(2);
      expect(out.recentExecutionsLimit).toBe(30);
    });

    it("toolArgs override agent config", () => {
      const agent = { learningConfig: { maxDerivedGood: 5 } };
      const out = resolveLearningConfig(agent, { maxDerivedGood: 8 });
      expect(out.maxDerivedGood).toBe(8);
    });

    it("ignores non-object learningConfig", () => {
      const out = resolveLearningConfig(
        { learningConfig: "invalid" as unknown as Record<string, unknown> },
        {}
      );
      expect(out.maxDerivedGood).toBe(20);
    });

    it("ignores array learningConfig", () => {
      const out = resolveLearningConfig(
        { learningConfig: [] as unknown as Record<string, unknown> },
        {}
      );
      expect(out.maxDerivedGood).toBe(20);
    });

    it("ignores null learningConfig and uses defaults", () => {
      const out = resolveLearningConfig({ learningConfig: null }, {});
      expect(out.maxDerivedGood).toBe(20);
    });
  });

  describe("getNested", () => {
    it("returns undefined for null or undefined obj", () => {
      expect(getNested(null, "a")).toBeUndefined();
      expect(getNested(undefined, "a")).toBeUndefined();
    });

    it("returns value for single key", () => {
      expect(getNested({ a: 1 }, "a")).toBe(1);
      expect(getNested({ x: "y" }, "x")).toBe("y");
    });

    it("returns nested value for path", () => {
      expect(getNested({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
    });

    it("returns undefined when path goes through null", () => {
      expect(getNested({ a: null }, "a.b")).toBeUndefined();
    });

    it("returns undefined when path goes through non-object", () => {
      expect(getNested({ a: 5 }, "a.b")).toBeUndefined();
    });

    it("returns root last segment when path goes invalid and length > 1", () => {
      const obj = { a: { b: 10 }, key: 99 };
      expect(getNested(obj, "a.missing.key")).toBe(99);
    });

    it("returns undefined for empty path", () => {
      expect(getNested({ a: 1 }, "")).toBeUndefined();
    });

    it("returns root[last] when traversal ends at undefined but root has last key", () => {
      expect(getNested({ a: {}, b: 77 }, "a.b")).toBe(77);
    });
  });

  describe("resolveTemplateVars", () => {
    it("returns args when no prior results", () => {
      expect(resolveTemplateVars({ x: 1 }, [])).toEqual({ x: 1 });
    });

    it("replaces {{ toolName.path }} with nested value", () => {
      const args = { msg: "Result: {{ t1.output.text }}" };
      const prior = [{ name: "t1", result: { output: { text: "Hello" } } }];
      expect(resolveTemplateVars(args, prior)).toEqual({ msg: "Result: Hello" });
    });

    it("keeps match when nested value is null/undefined", () => {
      const args = { msg: "{{ t1.missing }}" };
      const prior = [{ name: "t1", result: {} }];
      expect(resolveTemplateVars(args, prior)).toEqual({ msg: "{{ t1.missing }}" });
    });

    it("uses latest result when same tool name appears twice", () => {
      const args = { msg: "{{ t1.v }}" };
      const prior = [
        { name: "t1", result: { v: 1 } },
        { name: "t1", result: { v: 2 } },
      ];
      expect(resolveTemplateVars(args, prior)).toEqual({ msg: "2" });
    });

    it("recurses into arrays and objects", () => {
      const args = { items: [{ label: "{{ t1.label }}" }] };
      const prior = [{ name: "t1", result: { label: "X" } }];
      expect(resolveTemplateVars(args, prior)).toEqual({ items: [{ label: "X" }] });
    });

    it("recurses into nested object with template var", () => {
      const args = { outer: { inner: { msg: "{{ t1.x }}" } } };
      const prior = [{ name: "t1", result: { x: "nested" } }];
      expect(resolveTemplateVars(args, prior)).toEqual({
        outer: { inner: { msg: "nested" } },
      });
    });
  });

  describe("resolveWorkflowIdFromArgs", () => {
    it("returns workflowId when workflowId is non-empty string", () => {
      expect(resolveWorkflowIdFromArgs({ workflowId: " wf-1 " })).toEqual({
        workflowId: "wf-1",
      });
    });

    it("returns workflowId when id is used instead of workflowId", () => {
      expect(resolveWorkflowIdFromArgs({ id: "wf-2" })).toEqual({ workflowId: "wf-2" });
    });

    it("prefers workflowId over id", () => {
      expect(resolveWorkflowIdFromArgs({ workflowId: "a", id: "b" })).toEqual({
        workflowId: "a",
      });
    });

    it("returns error when direct is empty string", () => {
      expect(resolveWorkflowIdFromArgs({ workflowId: "   " })).toMatchObject({
        error: expect.stringContaining("Workflow id is required"),
      });
    });

    it("returns workflowId when workflowIdentifierField is id and value set", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "id",
          workflowIdentifierValue: " wf-3 ",
        })
      ).toEqual({ workflowId: "wf-3" });
    });

    it("returns workflowId when workflowIdentifierField is ID (case insensitive)", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "ID",
          workflowIdentifierValue: "wf-4",
        })
      ).toEqual({ workflowId: "wf-4" });
    });

    it("returns error when workflowIdentifierValue is empty", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "id",
          workflowIdentifierValue: "",
        })
      ).toMatchObject({ error: expect.stringContaining("Workflow id is required") });
    });

    it("returns error when workflowIdentifierField is not id", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "name",
          workflowIdentifierValue: "my-workflow",
        })
      ).toMatchObject({ error: expect.stringContaining("Workflow id is required") });
    });

    it("returns error when no workflow id args provided", () => {
      expect(resolveWorkflowIdFromArgs({})).toMatchObject({
        error: expect.stringContaining("Workflow id is required"),
      });
    });

    it("returns error when workflowIdentifierField is not a string", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: 123 as unknown as string,
          workflowIdentifierValue: "wf-x",
        })
      ).toMatchObject({ error: expect.stringContaining("Workflow id is required") });
    });

    it("returns error when workflowIdentifierValue is not a string", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "id",
          workflowIdentifierValue: null as unknown as string,
        })
      ).toMatchObject({ error: expect.stringContaining("Workflow id is required") });
    });

    it("returns workflowId when direct is whitespace-only then falls back to identifier", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowId: "   ",
          workflowIdentifierField: "id",
          workflowIdentifierValue: "wf-fallback",
        })
      ).toEqual({ workflowId: "wf-fallback" });
    });
  });

  describe("ensureRunnerSandboxId", () => {
    beforeEach(() => {
      mockContainerCreate.mockClear();
    });

    it("returns existing sandbox id when row exists with running container", async () => {
      const id = "runner-existing-" + Date.now();
      await db
        .insert(sandboxes)
        .values(
          toSandboxRow({
            id,
            name: "agentron-runner-node",
            image: "node:22-slim",
            status: "running",
            containerId: "existing-cid",
            config: {},
            createdAt: Date.now(),
          })
        )
        .run();
      try {
        const out = await ensureRunnerSandboxId("node");
        expect(out).toBe(id);
        expect(mockContainerCreate).not.toHaveBeenCalled();
      } finally {
        await db.delete(sandboxes).where(eq(sandboxes.id, id)).run();
      }
    });

    it("creates container and updates when row exists but not running", async () => {
      const id = "runner-not-running-" + Date.now();
      await db
        .insert(sandboxes)
        .values(
          toSandboxRow({
            id,
            name: "agentron-runner-node",
            image: "node:22-slim",
            status: "stopped",
            containerId: undefined,
            config: {},
            createdAt: Date.now(),
          })
        )
        .run();
      try {
        const out = await ensureRunnerSandboxId("node");
        expect(out).toBe(id);
        expect(mockContainerCreate).toHaveBeenCalledWith(
          "node:22-slim",
          `agentron-runner-node-${id}`,
          { network: true }
        );
      } finally {
        await db.delete(sandboxes).where(eq(sandboxes.id, id)).run();
      }
    });

    it("creates new sandbox when no row exists", async () => {
      const existing = await db
        .select({ id: sandboxes.id })
        .from(sandboxes)
        .where(eq(sandboxes.name, "agentron-runner-python"));
      for (const row of existing) {
        await db.delete(sandboxes).where(eq(sandboxes.id, row.id)).run();
      }
      const out = await ensureRunnerSandboxId("python");
      expect(out).toMatch(/^runner-agentron-runner-python-\d+$/);
      expect(mockContainerCreate).toHaveBeenCalled();
      await db.delete(sandboxes).where(eq(sandboxes.id, out)).run();
    });
  });

  describe("deriveFeedbackFromExecutionHistory", () => {
    it("returns empty array when no workflows reference the agent", async () => {
      const out = await deriveFeedbackFromExecutionHistory("agent-no-workflows-" + Date.now(), {
        maxDerivedGood: 20,
        maxDerivedBad: 20,
        recentExecutionsLimit: 50,
      });
      expect(out).toEqual([]);
    });

    it("derives bad from failed run with no matching trail step (uses run.targetId as input)", async () => {
      const agentId = "derive-fb-agent-nostep-" + Date.now();
      const wfId = "derive-fb-wf-nostep-" + Date.now();
      const runId = "derive-fb-run-nostep-" + Date.now();
      await db
        .insert(workflows)
        .values({
          id: wfId,
          name: "Derive FB WF NoStep",
          nodes: JSON.stringify([{ id: "n1", type: "agent", config: { agentId } }]),
          edges: "[]",
          executionMode: "manual",
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: wfId,
            status: "failed",
            output: { error: "Run failed", trail: [] },
          })
        )
        .run();
      try {
        const out = await deriveFeedbackFromExecutionHistory(agentId, {
          maxDerivedGood: 5,
          maxDerivedBad: 5,
          recentExecutionsLimit: 10,
        });
        const bad = out.filter((f) => f.label === "bad" && f.notes === "From failed run");
        expect(bad.length).toBe(1);
        expect(bad[0].input).toBe(wfId);
      } finally {
        await db.delete(executions).where(eq(executions.id, runId)).run();
        await db.delete(workflows).where(eq(workflows.id, wfId)).run();
      }
    });

    it("derives nothing from run whose output is array (trail treated as empty)", async () => {
      const agentId = "derive-fb-agent-array-out-" + Date.now();
      const wfId = "derive-fb-wf-array-out-" + Date.now();
      const runId = "derive-fb-run-array-out-" + Date.now();
      await db
        .insert(workflows)
        .values({
          id: wfId,
          name: "Derive FB WF Array Out",
          nodes: JSON.stringify([{ id: "n1", type: "agent", config: { agentId } }]),
          edges: "[]",
          executionMode: "manual",
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: wfId,
            status: "failed",
            output: [{ some: "array" }],
          })
        )
        .run();
      try {
        const out = await deriveFeedbackFromExecutionHistory(agentId, {
          maxDerivedGood: 5,
          maxDerivedBad: 5,
          recentExecutionsLimit: 10,
        });
        expect(out).toEqual([]);
      } finally {
        await db.delete(executions).where(eq(executions.id, runId)).run();
        await db.delete(workflows).where(eq(workflows.id, wfId)).run();
      }
    });

    it("derives bad from failed run and from trail step error, good from trail step input/output", async () => {
      const agentId = "derive-fb-agent-" + Date.now();
      const wfId = "derive-fb-wf-" + Date.now();
      const runId = "derive-fb-run-" + Date.now();
      await db
        .insert(workflows)
        .values({
          id: wfId,
          name: "Derive FB WF",
          nodes: JSON.stringify([{ id: "n1", type: "agent", config: { agentId } }]),
          edges: "[]",
          executionMode: "manual",
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: wfId,
            status: "failed",
            output: {
              error: "Run failed",
              trail: [
                { agentId: "other-agent", input: "x", output: "y" },
                { agentId, input: "in1", output: "out1", error: "Step error" },
                { agentId, input: "in2", output: "out2" },
              ],
            },
          })
        )
        .run();
      try {
        const out = await deriveFeedbackFromExecutionHistory(agentId, {
          maxDerivedGood: 5,
          maxDerivedBad: 5,
          recentExecutionsLimit: 10,
        });
        const bad = out.filter((f) => f.label === "bad");
        const good = out.filter((f) => f.label === "good");
        expect(bad.length).toBeGreaterThanOrEqual(1);
        expect(good.length).toBeGreaterThanOrEqual(1);
        expect(bad.some((f) => f.notes === "From failed run")).toBe(true);
        expect(bad.some((f) => f.notes === "From step error")).toBe(true);
        expect(good.some((f) => f.input === "in2" && f.output === "out2")).toBe(true);
      } finally {
        await db.delete(executions).where(eq(executions.id, runId)).run();
        await db.delete(workflows).where(eq(workflows.id, wfId)).run();
      }
    });
  });

  describe("enrichAgentToolResult", () => {
    it("returns result when result is null", async () => {
      expect(await enrichAgentToolResult(null)).toBeNull();
    });

    it("returns result when result is undefined", async () => {
      expect(await enrichAgentToolResult(undefined)).toBeUndefined();
    });

    it("returns result when result is an array", async () => {
      const arr = [1, 2];
      expect(await enrichAgentToolResult(arr)).toBe(arr);
    });

    it("returns result when result has error property", async () => {
      const result = { error: "Something failed" };
      expect(await enrichAgentToolResult(result)).toEqual(result);
    });

    it("returns result unchanged when no toolIds in result, definition, or args", async () => {
      const result = { definition: {}, other: true };
      expect(await enrichAgentToolResult(result)).toEqual(result);
    });

    it("returns result with tools array when toolIds present and tool exists in db", async () => {
      const id = `enrich-test-${Date.now()}`;
      const tool = {
        id,
        name: "Enrich Test Tool",
        protocol: "native" as const,
        config: {},
      };
      await db.insert(tools).values(toToolRow(tool)).run();
      try {
        const result = { toolIds: [id] };
        const out = await enrichAgentToolResult(result);
        expect(out).toMatchObject({ tools: [{ id, name: "Enrich Test Tool" }] });
      } finally {
        await db.delete(tools).where(eq(tools.id, id)).run();
      }
    });

    it("collects toolIds from args when result has no toolIds", async () => {
      const id = `enrich-args-${Date.now()}`;
      await db
        .insert(tools)
        .values(toToolRow({ id, name: "Args Tool", protocol: "native", config: {} }))
        .run();
      try {
        const out = await enrichAgentToolResult({ other: true }, { toolIds: [id] });
        expect(out).toMatchObject({ tools: [{ id, name: "Args Tool" }] });
      } finally {
        await db.delete(tools).where(eq(tools.id, id)).run();
      }
    });

    it("collects toolIds from result.definition.toolIds", async () => {
      const id = `enrich-def-${Date.now()}`;
      await db
        .insert(tools)
        .values(toToolRow({ id, name: "Def Tool", protocol: "native", config: {} }))
        .run();
      try {
        const out = await enrichAgentToolResult({ definition: { toolIds: [id] } });
        expect(out).toMatchObject({ tools: [{ id, name: "Def Tool" }] });
      } finally {
        await db.delete(tools).where(eq(tools.id, id)).run();
      }
    });
  });

  describe("logToolPhase and logToolSuccessAndReturn", () => {
    beforeEach(() => {
      mockAppendLogLine.mockClear();
    });

    it("logToolPhase does not call appendLogLine when ctx is undefined", () => {
      logToolPhase(undefined, "start", "my_tool");
      expect(mockAppendLogLine).not.toHaveBeenCalled();
    });

    it("logToolPhase does not call appendLogLine when ctx.traceId is missing", () => {
      logToolPhase({ conversationId: "c1" }, "start", "my_tool");
      expect(mockAppendLogLine).not.toHaveBeenCalled();
    });

    it("logToolPhase calls appendLogLine with route, method, and message when ctx.traceId is set", () => {
      const ctx = { traceId: "trace-123" };
      logToolPhase(ctx, "start", "my_tool");
      expect(mockAppendLogLine).toHaveBeenCalledTimes(1);
      expect(mockAppendLogLine).toHaveBeenCalledWith(
        "chat/execute-tool",
        "tool",
        "traceId=trace-123 phase=tool toolName=my_tool status=start"
      );
    });

    it("logToolPhase includes detail in message when provided", () => {
      logToolPhase({ traceId: "t1" }, "error", "tool_x", "error=Something failed");
      expect(mockAppendLogLine).toHaveBeenCalledWith(
        "chat/execute-tool",
        "tool",
        "traceId=t1 phase=tool toolName=tool_x status=error error=Something failed"
      );
    });

    it("logToolSuccessAndReturn returns result and does not log when ctx has no traceId", () => {
      const result = { id: "r1" };
      const out = logToolSuccessAndReturn(undefined, "get_run", result);
      expect(out).toBe(result);
      expect(mockAppendLogLine).not.toHaveBeenCalled();
    });

    it("logToolSuccessAndReturn returns result and logs success with resultHint when ctx.traceId set", () => {
      const result = { id: "r1", status: "completed" };
      const out = logToolSuccessAndReturn({ traceId: "t2" }, "get_run", result);
      expect(out).toBe(result);
      expect(mockAppendLogLine).toHaveBeenCalledTimes(1);
      expect(mockAppendLogLine).toHaveBeenCalledWith(
        "chat/execute-tool",
        "tool",
        expect.stringMatching(/^traceId=t2 phase=tool toolName=get_run status=success resultHint=/)
      );
    });
  });
});
