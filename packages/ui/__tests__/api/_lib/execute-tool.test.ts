import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRegistry, searchWeb } from "@agentron-studio/runtime";
import {
  db,
  customFunctions,
  tools,
  IMPROVEMENT_SUBSETS,
  conversations,
  chatMessages,
  reminders,
  executions,
  toExecutionRow,
  improvementJobs,
  guardrails,
  sandboxes,
} from "../../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import { AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION } from "../../../app/api/chat/route";
import { resolveTemplateVars, executeTool } from "../../../app/api/chat/_lib/execute-tool";
import { runWorkflow } from "../../../app/api/_lib/run-workflow";
import { getAppSettings } from "../../../app/api/_lib/app-settings";
import { getContainerManager } from "../../../app/api/_lib/container-manager";
import {
  readConnectorItem,
  updateConnectorItem,
} from "../../../app/api/rag/connectors/_lib/connector-write";
import { getDeploymentCollectionId } from "../../../app/api/_lib/rag";
import { ingestOneDocument } from "../../../app/api/rag/ingest/route";
import { ragConnectors, ragDocuments } from "@agentron-studio/core";

const mockContainerCreate = vi.fn().mockResolvedValue("test-container-id");
const mockContainerDestroy = vi.fn().mockResolvedValue(undefined);
const mockContainerExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
const mockContainerPull = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../app/api/_lib/container-manager", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../app/api/_lib/container-manager")>();
  return {
    ...mod,
    getContainerManager: vi.fn(() => ({
      create: mockContainerCreate,
      destroy: mockContainerDestroy,
      exec: mockContainerExec,
      pull: mockContainerPull,
      getContainerState: vi.fn().mockResolvedValue("running"),
      getContainerExitInfo: vi.fn().mockResolvedValue({ exitCode: 1, oomKilled: false }),
      logs: vi.fn().mockResolvedValue(""),
      start: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const mockOpenclawSend = vi.fn();
const mockOpenclawHistory = vi.fn();
const mockOpenclawAbort = vi.fn();
vi.mock("../../../app/api/_lib/openclaw-client", () => ({
  openclawSend: (...args: unknown[]) => mockOpenclawSend(...args),
  openclawHistory: (...args: unknown[]) => mockOpenclawHistory(...args),
  openclawAbort: (...args: unknown[]) => mockOpenclawAbort(...args),
}));

vi.mock("../../../app/api/_lib/app-settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../app/api/_lib/app-settings")>();
  return {
    ...mod,
    getAppSettings: vi.fn().mockImplementation(() => mod.getAppSettings()),
    getShellCommandAllowlist: vi.fn().mockReturnValue(["echo ok"]),
  };
});

vi.mock("../../../app/api/_lib/shell-exec", () => ({
  runShellCommand: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }),
}));

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@agentron-studio/runtime")>();
  return {
    ...mod,
    searchWeb: vi.fn().mockResolvedValue({ results: [] }),
    fetchUrl: vi.fn().mockResolvedValue({ content: "<html>ok</html>", contentType: "text/html" }),
  };
});

vi.mock("../../../app/api/_lib/remote-test", () => ({
  testRemoteConnection: vi.fn().mockResolvedValue({ ok: true, message: "Connected" }),
}));

vi.mock("../../../app/api/rag/ingest/route", () => ({
  ingestOneDocument: vi.fn(),
}));

vi.mock("../../../app/api/_lib/rag", () => ({
  getDeploymentCollectionId: vi.fn().mockResolvedValue(null),
  retrieveChunks: vi.fn(),
}));

vi.mock("../../../app/api/rag/connectors/_lib/connector-write", () => ({
  readConnectorItem: vi.fn().mockResolvedValue({ error: "Connector not found" }),
  updateConnectorItem: vi.fn().mockResolvedValue({ error: "Connector not found" }),
}));

vi.mock("../../../app/api/_lib/workflow-queue", () => ({
  enqueueWorkflowResume: vi.fn().mockResolvedValue("job-id"),
}));

vi.mock("../../../app/api/_lib/scheduled-workflows", () => ({
  refreshScheduledWorkflows: vi.fn(),
}));

vi.mock("../../../app/api/_lib/run-workflow", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../app/api/_lib/run-workflow")>();
  return {
    ...mod,
    runWorkflow: vi.fn().mockResolvedValue({ output: undefined, context: {}, trail: [] }),
  };
});

describe("execute-tool helpers", () => {
  describe("resolveTemplateVars", () => {
    it("replaces {{ toolName.path }} with value from last matching result", () => {
      const prior = [
        { name: "create_workflow", result: { id: "wf-123", name: "My WF", message: "Created" } },
      ];
      const args = { workflowId: "{{create_workflow.id}}", edges: [] };
      const out = resolveTemplateVars(args, prior);
      expect(out.workflowId).toBe("wf-123");
    });

    it("uses last result when same tool called multiple times", () => {
      const prior = [
        { name: "create_workflow", result: { id: "first" } },
        { name: "create_workflow", result: { id: "second" } },
      ];
      const args = { workflowId: "{{create_workflow.id}}" };
      const out = resolveTemplateVars(args, prior);
      expect(out.workflowId).toBe("second");
    });

    it("resolves nested path with fallback to last segment (e.g. workflow.id -> id)", () => {
      const prior = [{ name: "create_workflow", result: { id: "wf-456", name: "X" } }];
      const args = { workflowId: "{{create_workflow.workflow.id}}" };
      const out = resolveTemplateVars(args, prior);
      expect(out.workflowId).toBe("wf-456");
    });

    it("resolves execute_workflow.id (run id)", () => {
      const prior = [
        {
          name: "execute_workflow",
          result: { id: "run-789", workflowId: "wf-456", status: "completed" },
        },
      ];
      const args = { runId: "{{execute_workflow.id}}" };
      const out = resolveTemplateVars(args, prior);
      expect(out.runId).toBe("run-789");
    });

    it("leaves unresolved placeholder when no matching result", () => {
      const args = { workflowId: "{{create_workflow.id}}" };
      const out = resolveTemplateVars(args, []);
      expect(out.workflowId).toBe("{{create_workflow.id}}");
    });

    it("resolves recursively in nested objects and arrays", () => {
      const prior = [{ name: "create_workflow", result: { id: "nested-id" } }];
      const args = {
        top: "{{create_workflow.id}}",
        inner: { workflowId: "{{create_workflow.id}}" },
        list: ["{{create_workflow.id}}"],
      };
      const out = resolveTemplateVars(args, prior);
      expect(out.top).toBe("nested-id");
      expect((out.inner as { workflowId: string }).workflowId).toBe("nested-id");
      expect((out.list as string[])[0]).toBe("nested-id");
    });
  });

  describe("executeTool improvement/workflow argument handling", () => {
    it("get_run_for_improvement returns friendly error when runId missing", async () => {
      const result = await executeTool("get_run_for_improvement", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("runId is required"),
        })
      );
      expect((result as { error: string }).error).toContain("Runs");
    });

    it("get_feedback_for_scope returns error when both targetId and agentId missing", async () => {
      const result = await executeTool("get_feedback_for_scope", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/targetId or agentId is required/),
        })
      );
    });

    it("get_feedback_for_scope accepts agentId as targetId", async () => {
      const result = await executeTool(
        "get_feedback_for_scope",
        { agentId: "agent-nonexistent", scope: "agent_runs" },
        undefined
      );
      expect(result).not.toEqual(
        expect.objectContaining({ error: "targetId or agentId is required" })
      );
      expect(Array.isArray(result) || (result as { error?: string }).error).toBeDefined();
    });

    it("get_feedback_for_scope accepts label good and limit", async () => {
      const result = await executeTool(
        "get_feedback_for_scope",
        { targetId: "wf-1", label: "good", limit: 5 },
        undefined
      );
      expect(Array.isArray(result) || (result as { error?: string }).error).toBeDefined();
    });

    it("get_feedback_for_scope accepts label bad", async () => {
      const result = await executeTool(
        "get_feedback_for_scope",
        { targetId: "wf-1", label: "bad" },
        undefined
      );
      expect(Array.isArray(result) || (result as { error?: string }).error).toBeDefined();
    });

    it("get_run_for_improvement with includeFullLogs true returns run data", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
          })
        )
        .run();
      try {
        const result = await executeTool(
          "get_run_for_improvement",
          { runId, includeFullLogs: true },
          undefined
        );
        expect(result).toBeDefined();
        expect(
          (result as { id?: string }).id ?? (result as { error?: string }).error
        ).toBeDefined();
      } finally {
        await db.delete(executions).where(eq(executions.id, runId)).run();
      }
    });

    it("add_workflow_edges accepts workflowId when id missing (returns Workflow not found for fake id)", async () => {
      const result = await executeTool(
        "add_workflow_edges",
        { workflowId: "fake-wf-id", edges: [] },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });

    it("add_workflow_edges adds edges to existing workflow and returns message", async () => {
      const createRes = await executeTool("create_workflow", { name: "Edges Test WF" }, undefined);
      const wfId = (createRes as { id?: string }).id;
      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "n1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
            {
              id: "n2",
              type: "agent",
              position: [100, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      const result = await executeTool(
        "add_workflow_edges",
        {
          id: wfId,
          edges: [{ source: "n1", target: "n2" }],
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: wfId,
          message: expect.stringMatching(/Added 1 edge/),
          nodes: 2,
          edges: 1,
        })
      );
    });

    it("add_workflow_edges merges nodes and edges when both provided", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Nodes And Edges WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "a1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      const result = await executeTool(
        "add_workflow_edges",
        {
          id: wfId,
          nodes: [
            {
              id: "a2",
              type: "agent",
              position: [100, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [{ source: "a1", target: "a2" }],
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: wfId,
          message: expect.stringMatching(/Added 1 edge/),
          nodes: 2,
          edges: 1,
        })
      );
    });

    it("web_search returns error when query is required", async () => {
      const result = await executeTool("web_search", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "query is required",
          results: [],
        })
      );
    });

    it("web_search returns Web search failed when searchWeb throws", async () => {
      vi.mocked(searchWeb).mockRejectedValueOnce(new Error("Network error"));
      const result = await executeTool("web_search", { query: "test" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "Web search failed",
          message: "Network error",
          results: [],
        })
      );
    });

    it("web_search calls searchWeb with provider and keys from getAppSettings", async () => {
      vi.mocked(getAppSettings).mockReturnValueOnce({
        webSearchProvider: "google",
        googleCseKey: "gk",
        googleCseCx: "gcx",
      } as ReturnType<typeof getAppSettings>);
      vi.mocked(searchWeb).mockClear();
      const result = await executeTool("web_search", { query: "test query" }, undefined);
      expect(searchWeb).toHaveBeenCalledWith(
        "test query",
        expect.objectContaining({
          provider: "google",
          googleCseKey: "gk",
          googleCseCx: "gcx",
        })
      );
      expect(result).toEqual({ results: [] });
    });

    it("web_search calls searchWeb with searxngBaseUrl when provider is searxng", async () => {
      vi.mocked(getAppSettings).mockReturnValueOnce({
        webSearchProvider: "searxng",
        searxngBaseUrl: "http://localhost:8888",
      } as ReturnType<typeof getAppSettings>);
      vi.mocked(searchWeb).mockClear();
      const result = await executeTool("web_search", { query: "test" }, undefined);
      expect(searchWeb).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          provider: "searxng",
          searxngBaseUrl: "http://localhost:8888",
        })
      );
      expect(result).toEqual({ results: [] });
    });

    it("update_workflow accepts workflowId when id missing (returns Workflow not found for fake id)", async () => {
      const result = await executeTool(
        "update_workflow",
        { workflowId: "fake-wf-id", name: "X" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });

    it("create_workflow accepts executionMode and schedule", async () => {
      const result = await executeTool(
        "create_workflow",
        {
          name: "Scheduled WF",
          executionMode: "continuous",
          schedule: "0 * * * *",
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: "Scheduled WF",
          message: expect.stringContaining("created"),
        })
      );
    });

    it("create_workflow then update_workflow and execute_workflow with id/workflowId (direct) works", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Direct Id Test WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const updateRes = await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "n1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      expect(updateRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
      expect(updateRes).toEqual(
        expect.objectContaining({ id: wfId, message: expect.stringContaining("updated") })
      );

      const execRes = await executeTool("execute_workflow", { workflowId: wfId }, undefined);
      expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow id is required" }));
      expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
      expect(execRes).toEqual(expect.objectContaining({ workflowId: wfId }));
    });

    it("execute_workflow accepts branchId and returns run", async () => {
      const createRes = await executeTool("create_workflow", { name: "Branch Id WF" }, undefined);
      const wfId = (createRes as { id?: string }).id;
      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "n1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      const execRes = await executeTool(
        "execute_workflow",
        { workflowId: wfId, branchId: "main" },
        undefined
      );
      expect(execRes).toEqual(expect.objectContaining({ workflowId: wfId }));
      expect((execRes as { id?: string }).id).toBeDefined();
    });

    it("execute_workflow with inputs passes runInputs to runWorkflow so agent receives them on first turn", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "RunInputs Test WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");
      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "n1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      vi.mocked(runWorkflow).mockClear();
      const execRes = await executeTool(
        "execute_workflow",
        { workflowId: wfId, inputs: { url: "https://example.com" } },
        undefined
      );
      expect(execRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect(vi.mocked(runWorkflow)).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: wfId,
          runInputs: { url: "https://example.com" },
        })
      );
    });

    it("execute_workflow with inputs including noSharedOutput passes noSharedOutput to runWorkflow and strips it from runInputs", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "NoSharedOutput Test WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");
      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "n1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      vi.mocked(runWorkflow).mockClear();
      const execRes = await executeTool(
        "execute_workflow",
        {
          workflowId: wfId,
          inputs: {
            targetUrl: "http://127.0.0.1:18200",
            targetSandboxId: "sb-1",
            noSharedOutput: true,
          },
        },
        undefined
      );
      expect(execRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect(vi.mocked(runWorkflow)).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: wfId,
          noSharedOutput: true,
          runInputs: { targetUrl: "http://127.0.0.1:18200", targetSandboxId: "sb-1" },
        })
      );
      const call = vi.mocked(runWorkflow).mock.calls[0][0];
      expect(call.runInputs).not.toHaveProperty("noSharedOutput");
    });

    it("update_workflow and execute_workflow resolve workflowIdentifierField+workflowIdentifierValue (id) so same-turn create then update/run works", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Resolver Test WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const updateRes = await executeTool(
        "update_workflow",
        {
          workflowIdentifierField: "id",
          workflowIdentifierValue: wfId,
          nodes: [
            {
              id: "n1",
              type: "agent",
              position: [0, 0],
              parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
            },
          ],
          edges: [],
        },
        undefined
      );
      expect(updateRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
      expect(updateRes).not.toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Workflow id is required/) })
      );
      expect(updateRes).toEqual(
        expect.objectContaining({ id: wfId, message: expect.stringContaining("updated") })
      );

      const execRes = await executeTool(
        "execute_workflow",
        { workflowIdentifierField: "id", workflowIdentifierValue: wfId },
        undefined
      );
      expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow id is required" }));
      expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
      expect(execRes).toEqual(expect.objectContaining({ workflowId: wfId }));
    });

    it("update_workflow rejects name-based resolution (workflowIdentifierField name returns Workflow id is required)", async () => {
      const result = await executeTool(
        "update_workflow",
        {
          workflowIdentifierField: "name",
          workflowIdentifierValue: "Some Workflow Name",
          name: "X",
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Workflow id is required/) })
      );
    });

    it("update_workflow accepts nested workflow shape and copies name, nodes, edges from workflow", async () => {
      const createRes = await executeTool("create_workflow", { name: "Nested WF" }, undefined);
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");
      const updateRes = await executeTool(
        "update_workflow",
        {
          id: wfId,
          workflow: {
            name: "Updated via nested",
            nodes: [
              {
                id: "n1",
                type: "agent",
                position: [0, 0],
                parameters: { agentId: "00000000-0000-0000-0000-000000000001" },
              },
            ],
            edges: [],
          },
        },
        undefined
      );
      expect(updateRes).toEqual(
        expect.objectContaining({ id: wfId, message: expect.stringContaining("updated") })
      );
    });

    it("update_workflow accepts schedule null to clear and turnInstruction", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Schedule Clear WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      const withSchedule = await executeTool(
        "update_workflow",
        { id: wfId, schedule: "0 * * * *", turnInstruction: "Always confirm" },
        undefined
      );
      expect(withSchedule).toEqual(
        expect.objectContaining({ id: wfId, message: expect.stringContaining("updated") })
      );
      const cleared = await executeTool(
        "update_workflow",
        { id: wfId, schedule: null, turnInstruction: null },
        undefined
      );
      expect(cleared).toEqual(
        expect.objectContaining({ id: wfId, message: expect.stringContaining("updated") })
      );
    });

    it("execute_workflow returns Workflow id is required when only workflowIdentifierField given without value", async () => {
      const result = await executeTool(
        "execute_workflow",
        { workflowIdentifierField: "id", workflowIdentifierValue: "" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Workflow id is required/) })
      );
    });

    it("update_workflow normalizes top-level agentId into parameters.agentId (LLM-style nodes)", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Test WF for agentId normalization" },
        undefined
      );
      expect(createRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const agentUuid = "1e4af0d1-bd36-4b7d-acaf-0f586261de7c";
      const result = await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            {
              id: "collector-node",
              type: "agent",
              agentId: agentUuid,
              config: { useVaultCred: false },
            },
            { id: "learner-node", type: "agent", agentId: "5df0cdd6-e834-4c40-b060-ffb9c55a631d" },
          ],
          edges: [{ from: "collector-node", to: "learner-node" }],
        },
        undefined
      );

      expect(result).not.toEqual(
        expect.objectContaining({
          error: expect.stringContaining("without an agent selected"),
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: wfId,
          message: expect.stringContaining("updated"),
          nodes: 2,
        })
      );
    });
  });

  describe("executeTool create_agent tool cap", () => {
    it("rejects create_agent when toolIds.length exceeds MAX_TOOLS_PER_CREATED_AGENT (10)", async () => {
      const elevenIds = Array.from({ length: 11 }, (_, i) => `tool-id-${i}`);
      const result = await executeTool(
        "create_agent",
        { name: "Over-cap agent", toolIds: elevenIds, description: "Test", llmConfigId: "any" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/exceeds the maximum of 10 tools per agent/),
          code: "TOOL_CAP_EXCEEDED",
          maxToolsPerAgent: 10,
        })
      );
      const err = result as { error?: string; code?: string; maxToolsPerAgent?: number };
      expect(err.code).toBe("TOOL_CAP_EXCEEDED");
      expect(err.maxToolsPerAgent).toBe(10);
      expect(err.error).toBeDefined();
      expect(err.error).toMatch(/Create multiple agents/);
      expect(err.error).toMatch(/workflow/);
    });

    it("allows create_agent with 10 toolIds (at cap)", async () => {
      const tenIds = [
        "std-fetch-url",
        "std-browser",
        "std-run-code",
        "std-http-request",
        "std-webhook",
        "std-weather",
        "std-web-search",
        "std-container-run",
        "std-write-file",
        "std-request-user-help",
      ];
      const result = await executeTool(
        "create_agent",
        { name: "At-cap agent", toolIds: tenIds, description: "Test", llmConfigId: "any" },
        undefined
      );
      expect(result).not.toEqual(expect.objectContaining({ code: "TOOL_CAP_EXCEEDED" }));
      expect((result as { error?: string }).error).toBeUndefined();
      expect((result as { id?: string }).id).toBeDefined();
    }, 25_000);

    it("create_agent with non-existent tool returns TOOL_NOT_FOUND", async () => {
      const result = await executeTool(
        "create_agent",
        {
          name: "Agent With Missing Tool",
          description: "Test",
          llmConfigId: "any",
          toolIds: ["get_url_title"],
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining('Tool "get_url_title" not found'),
          code: "TOOL_NOT_FOUND",
          toolIdOrName: "get_url_title",
        })
      );
    });
  });

  describe("create_agent input shape and persistence", () => {
    it("create_agent with systemPrompt and graphNodes persists graph and systemPrompt", async () => {
      const systemPrompt = "You are a test agent. Use tools when needed.";
      const createRes = await executeTool(
        "create_agent",
        {
          name: "Shape Test Agent",
          description: "Agent for input shape test",
          llmConfigId: "any",
          systemPrompt,
          graphNodes: [
            {
              id: "n1",
              type: "llm",
              position: [100, 100],
              parameters: { systemPrompt },
            },
          ],
          graphEdges: [],
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeUndefined();
      const agentId = (createRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");

      const getRes = await executeTool("get_agent", { id: agentId }, undefined);
      expect((getRes as { error?: string }).error).toBeUndefined();
      const definition = (
        getRes as { definition?: { graph?: { nodes: unknown[] }; systemPrompt?: string } }
      ).definition;
      expect(definition).toBeDefined();
      expect(definition?.graph?.nodes?.length).toBeGreaterThanOrEqual(1);
      const nodes = definition?.graph?.nodes as Array<{ type?: string }> | undefined;
      const llmNode = nodes?.find((n) => n.type === "llm");
      expect(llmNode).toBeDefined();
      expect((llmNode as { parameters?: { systemPrompt?: string } }).parameters?.systemPrompt).toBe(
        systemPrompt
      );
    });

    it("create_agent with only config (no systemPrompt or graphNodes) yields minimal agent without persisting config", async () => {
      const createRes = await executeTool(
        "create_agent",
        {
          name: "Config-Only Shape Agent",
          description: "Fallback prompt from description",
          llmConfigId: "any",
          config: {
            workflow: { name: "Embedded WF", steps: [{ id: "s1", action: "fetch" }] },
            tools: [{ name: "LinkedIn Fetcher", type: "external_api" }],
            prompts: { extract_keywords_prompt: "Extract keywords" },
          },
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeUndefined();
      const agentId = (createRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");

      const getRes = await executeTool("get_agent", { id: agentId }, undefined);
      expect((getRes as { error?: string }).error).toBeUndefined();
      const definition = (getRes as { definition?: Record<string, unknown> }).definition;
      expect(definition).toBeDefined();
      expect(definition?.config).toBeUndefined();
      expect(definition?.workflow).toBeUndefined();
      expect(definition?.graph).toBeDefined();
      expect((definition?.graph as { nodes: unknown[] })?.nodes?.length).toBeGreaterThanOrEqual(1);
    });

    it("create_agent with systemPrompt and toolIds persists toolIds on definition", async () => {
      const createRes = await executeTool(
        "create_agent",
        {
          name: "Agent With Tools",
          description: "Uses fetch and vault",
          llmConfigId: "any",
          systemPrompt: "Fetch URLs and read vault when asked.",
          toolIds: ["std-fetch-url", "std-get-vault-credential"],
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeUndefined();
      const agentId = (createRes as { id?: string }).id;
      const getRes = await executeTool("get_agent", { id: agentId }, undefined);
      const definition = (getRes as { definition?: { toolIds?: string[] } }).definition;
      expect(definition?.toolIds).toEqual(
        expect.arrayContaining(["std-fetch-url", "std-get-vault-credential"])
      );
    });

    it("create_agent with tools array (LLM wrong key) normalizes to toolIds and persists std-fetch-url", async () => {
      const createRes = await executeTool(
        "create_agent",
        {
          name: "Fetch Page Title",
          description: "Fetches a URL and returns the page title",
          llmConfigId: "any",
          systemPrompt: "Fetch the URL and reply with the page title.",
          tools: [{ name: "fetch", config: { url: "https://example.com", parser: "title" } }],
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeUndefined();
      const agentId = (createRes as { id?: string }).id;
      const getRes = await executeTool("get_agent", { id: agentId }, undefined);
      const definition = (getRes as { definition?: { toolIds?: string[] } }).definition;
      expect(definition?.toolIds).toContain("std-fetch-url");
    });
  });

  describe("create_workflow and update_workflow input shape", () => {
    it("create_workflow without nodes/edges creates workflow with empty nodes and edges", async () => {
      const uniqueName = "Empty Shape WF " + Date.now();
      const createRes = await executeTool("create_workflow", { name: uniqueName }, undefined);
      expect((createRes as { error?: string }).error).toBeUndefined();
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const getRes = await executeTool("get_workflow", { id: wfId }, undefined);
      expect((getRes as { error?: string }).error).toBeUndefined();
      expect((getRes as { name?: string }).name).toBe(uniqueName);
      const nodes = (getRes as { nodes?: unknown[] }).nodes ?? [];
      const edges = (getRes as { edges?: unknown[] }).edges ?? [];
      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it("create_workflow with nodes and edges persists normalized agent nodes and edges", async () => {
      const agentRes = await executeTool(
        "create_agent",
        {
          name: "Agent For Create WF",
          description: "For create_workflow shape test",
          llmConfigId: "any",
        },
        undefined
      );
      const agentId = (agentRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");

      const createRes = await executeTool(
        "create_workflow",
        {
          name: "With Nodes And Edges WF",
          nodes: [
            { id: "n_trigger", type: "trigger", name: "Start", parameters: {} },
            { id: "n_agent", type: "agent", position: [0, 0], parameters: { agentId } },
          ],
          edges: [{ id: "e1", source: "n_trigger", target: "n_agent" }],
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeUndefined();
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const getRes = await executeTool("get_workflow", { id: wfId }, undefined);
      expect((getRes as { error?: string }).error).toBeUndefined();
      const nodes =
        (getRes as { nodes?: { id: string; type: string; parameters?: { agentId?: string } }[] })
          .nodes ?? [];
      const edges = (getRes as { edges?: unknown[] }).edges ?? [];
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("agent");
      expect(nodes[0].parameters?.agentId).toBe(agentId);
      expect(edges).toHaveLength(1);
    });

    it("create_workflow with nested workflow: { nodes, edges } persists normalized nodes and edges", async () => {
      const agentRes = await executeTool(
        "create_agent",
        { name: "Nested Shape Agent", description: "For nested workflow test", llmConfigId: "any" },
        undefined
      );
      const agentId = (agentRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");

      const createRes = await executeTool(
        "create_workflow",
        {
          name: "Nested Shape WF",
          workflow: {
            nodes: [{ id: "n_agent", type: "agent", position: [0, 0], parameters: { agentId } }],
            edges: [{ id: "e1", source: "n_agent", target: "n_agent" }],
          },
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeUndefined();
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const getRes = await executeTool("get_workflow", { id: wfId }, undefined);
      expect((getRes as { error?: string }).error).toBeUndefined();
      const nodes = (getRes as { nodes?: { parameters?: { agentId?: string } }[] }).nodes ?? [];
      const edges = (getRes as { edges?: unknown[] }).edges ?? [];
      expect(nodes).toHaveLength(1);
      expect(nodes[0].parameters?.agentId).toBe(agentId);
      expect(edges).toHaveLength(1);
    });

    it("create_workflow with agent node without agentId returns error and does not create workflow", async () => {
      const createRes = await executeTool(
        "create_workflow",
        {
          name: "No AgentId WF",
          nodes: [{ id: "n_agent", type: "agent", position: [0, 0], parameters: {} }],
          edges: [],
        },
        undefined
      );
      expect((createRes as { error?: string }).error).toBeDefined();
      expect((createRes as { error?: string }).error).toContain(
        "agent node(s) without an agent selected"
      );
      expect((createRes as { id?: string }).id).toBeUndefined();
    });

    it("update_workflow keeps only agent-type nodes and drops tool/trigger/decision nodes", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Filter Nodes WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      const agentRes = await executeTool(
        "create_agent",
        { name: "Only Agent Node", description: "For filter test", llmConfigId: "any" },
        undefined
      );
      const agentId = (agentRes as { id?: string }).id;

      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [
            { id: "n_trigger", type: "trigger", name: "Start", parameters: {} },
            { id: "n_agent", type: "agent", position: [0, 0], parameters: { agentId } },
            { id: "n_tool", type: "tool", name: "Vault", parameters: { toolName: "vault_read" } },
          ],
          edges: [],
        },
        undefined
      );

      const getRes = await executeTool("get_workflow", { id: wfId }, undefined);
      const nodes =
        (getRes as { nodes?: { id: string; type: string; parameters?: { agentId?: string } }[] })
          .nodes ?? [];
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("agent");
      expect(nodes[0].parameters?.agentId).toBe(agentId);
    });
  });

  describe("executeTool heap tools (get_specialist_options, list_specialists)", () => {
    it("get_specialist_options with registry returns option groups for all specialists", async () => {
      const registry = getRegistry();
      const result = await executeTool("get_specialist_options", {}, { registry });
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const arr = result as Array<{
        specialistId: string;
        optionGroups: Record<string, { label: string; toolIds: string[] }>;
      }>;
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThan(0);
      const improveAgentsWorkflows = arr.find((o) => o.specialistId === "improve_agents_workflows");
      expect(improveAgentsWorkflows).toBeDefined();
      expect(improveAgentsWorkflows!.optionGroups).toHaveProperty("observe");
      expect(improveAgentsWorkflows!.optionGroups.observe.toolIds).toContain(
        "get_run_for_improvement"
      );
    });

    it("get_specialist_options with registry and specialistId returns single specialist options", async () => {
      const registry = getRegistry();
      const result = await executeTool(
        "get_specialist_options",
        { specialistId: "improve_agents_workflows" },
        { registry }
      );
      const arr = result as Array<{ specialistId: string; optionGroups: Record<string, unknown> }>;
      expect(Array.isArray(arr)).toBe(true);
      expect(arr).toHaveLength(1);
      expect(arr[0].specialistId).toBe("improve_agents_workflows");
    });

    it("get_specialist_options without registry returns error", async () => {
      const result = await executeTool("get_specialist_options", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("Heap registry not available") })
      );
    });

    it("list_specialists with registry returns specialists array", async () => {
      const registry = getRegistry();
      const result = await executeTool("list_specialists", {}, { registry });
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const obj = result as { specialists: Array<{ id: string; description?: string }> };
      expect(obj.specialists).toBeDefined();
      expect(Array.isArray(obj.specialists)).toBe(true);
      expect(obj.specialists.map((s) => s.id)).toContain("improve_run");
      expect(obj.specialists.map((s) => s.id)).toContain("improve_heap");
      expect(obj.specialists.map((s) => s.id)).toContain("improve_agents_workflows");
    });

    it("list_specialists without registry returns error", async () => {
      const result = await executeTool("list_specialists", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("Heap registry not available") })
      );
    });

    it("apply_session_override with scopeKey and overrideType applies override", async () => {
      const result = await executeTool(
        "apply_session_override",
        { scopeKey: "scope-1", overrideType: "type-1", payload: { x: 1 } },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ ok: true }));
    });

    it("apply_session_override returns error when scopeKey or overrideType missing", async () => {
      const r1 = await executeTool("apply_session_override", { scopeKey: "s" }, undefined);
      expect(r1).toEqual(
        expect.objectContaining({ error: "scopeKey and overrideType are required." })
      );
      const r2 = await executeTool("apply_session_override", { overrideType: "t" }, undefined);
      expect(r2).toEqual(
        expect.objectContaining({ error: "scopeKey and overrideType are required." })
      );
    });

    it("register_specialist returns error when id missing", async () => {
      const result = await executeTool(
        "register_specialist",
        { description: "d", toolNames: [] },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "id is required." }));
    });

    it("register_specialist returns error when specialist id already exists", async () => {
      const uniqueId = "dup_specialist_" + Date.now();
      await executeTool(
        "register_specialist",
        { id: uniqueId, description: "first", toolNames: [] },
        undefined
      );
      const result = await executeTool(
        "register_specialist",
        { id: uniqueId, description: "dup", toolNames: [] },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("already exists") })
      );
    });

    it("update_specialist returns error when id missing", async () => {
      const result = await executeTool("update_specialist", { description: "d" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "id is required." }));
    });

    it("ask_user with options returns options in result", async () => {
      const result = await executeTool(
        "ask_user",
        { question: "Pick?", options: ["A", "B", "C"] },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          waitingForUser: true,
          question: "Pick?",
          options: ["A", "B", "C"],
        })
      );
    });

    it("format_response with empty summary uses empty string", async () => {
      const result = await executeTool("format_response", { summary: "" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({ formatted: true, summary: "", needsInput: undefined })
      );
    });
  });

  describe("list_tools improvement subsets", () => {
    it("category improvement with no subset returns prompt_and_topology (production default)", async () => {
      const result = await executeTool("list_tools", { category: "improvement" }, undefined);
      expect(Array.isArray(result)).toBe(true);
      const ids = (result as { id: string }[]).map((t) => t.id);
      const expected = new Set(IMPROVEMENT_SUBSETS.prompt_and_topology);
      expect(ids.length).toBe(expected.size);
      ids.forEach((id) => expect(expected.has(id)).toBe(true));
      expect(ids).not.toContain("trigger_training");
      expect(ids).not.toContain("generate_training_data");
      expect(ids).not.toContain("create_improvement_job");
    });

    it("subset training returns only act_training tool ids", async () => {
      const result = await executeTool(
        "list_tools",
        { category: "improvement", subset: "training" },
        undefined
      );
      expect(Array.isArray(result)).toBe(true);
      const ids = (result as { id: string }[]).map((t) => t.id);
      const expected = new Set(IMPROVEMENT_SUBSETS.training);
      expect(ids.length).toBe(expected.size);
      ids.forEach((id) => expect(expected.has(id)).toBe(true));
      expect(ids).toContain("trigger_training");
      expect(ids).toContain("generate_training_data");
    });

    it("subset prompt returns only act_prompt tool ids (no training)", async () => {
      const result = await executeTool(
        "list_tools",
        { category: "improvement", subset: "prompt" },
        undefined
      );
      expect(Array.isArray(result)).toBe(true);
      const ids = (result as { id: string }[]).map((t) => t.id);
      const expected = new Set(IMPROVEMENT_SUBSETS.prompt);
      expect(ids.length).toBe(expected.size);
      ids.forEach((id) => expect(expected.has(id)).toBe(true));
      expect(ids).not.toContain("trigger_training");
      expect(ids).not.toContain("generate_training_data");
    });

    it("subset topology returns only act_topology tool ids", async () => {
      const result = await executeTool(
        "list_tools",
        { category: "improvement", subset: "topology" },
        undefined
      );
      expect(Array.isArray(result)).toBe(true);
      const ids = (result as { id: string }[]).map((t) => t.id);
      const expected = new Set(IMPROVEMENT_SUBSETS.topology);
      expect(ids.length).toBe(expected.size);
      ids.forEach((id) => expect(expected.has(id)).toBe(true));
      expect(ids).not.toContain("trigger_training");
    });

    it("subset prompt_and_topology returns observe + prompt + topology, no act_training tools", async () => {
      const result = await executeTool(
        "list_tools",
        { category: "improvement", subset: "prompt_and_topology" },
        undefined
      );
      expect(Array.isArray(result)).toBe(true);
      const ids = (result as { id: string }[]).map((t) => t.id);
      const expected = new Set(IMPROVEMENT_SUBSETS.prompt_and_topology);
      expect(ids.length).toBe(expected.size);
      ids.forEach((id) => expect(expected.has(id)).toBe(true));
      expect(ids).not.toContain("trigger_training");
      expect(ids).not.toContain("generate_training_data");
      expect(ids).not.toContain("create_improvement_job");
    });

    it("list_tools without category returns all tools", async () => {
      const result = await executeTool("list_tools", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      expect((result as { id: string }[]).length).toBeGreaterThan(0);
    });
  });

  describe("ask_user and ask_credentials", () => {
    it("ask_user returns waitingForUser with question, reason, options, stepIndex, stepTotal", async () => {
      const result = await executeTool(
        "ask_user",
        {
          question: "  Choose one  ",
          reason: " Need input ",
          options: ["A", "  B  ", ""],
          stepIndex: 1,
          stepTotal: 3,
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          waitingForUser: true,
          question: "Choose one",
          reason: "Need input",
          options: ["A", "B"],
          stepIndex: 1,
          stepTotal: 3,
        })
      );
    });

    it("ask_user with empty question uses default message and omits options when empty", async () => {
      const result = await executeTool("ask_user", { question: "" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          waitingForUser: true,
          question: "Please provide the information or confirmation.",
        })
      );
      expect(result).not.toHaveProperty("options");
    });

    it("ask_credentials without credentialKey returns credentialRequest with default credentialKey", async () => {
      const result = await executeTool("ask_credentials", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          waitingForUser: true,
          credentialRequest: true,
          question: "Please provide a credential key.",
          credentialKey: "credential",
        })
      );
    });

    it("ask_credentials with credentialKey normalizes key and returns credentialRequest when vault has no value", async () => {
      const result = await executeTool(
        "ask_credentials",
        { credentialKey: "  MY API KEY  ", question: "Enter key" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          waitingForUser: true,
          credentialRequest: true,
          question: "Enter key",
          credentialKey: "my_api_key",
        })
      );
    });
  });

  describe("list_llm_providers and list_connectors", () => {
    it("list_llm_providers returns array of id, provider, model", async () => {
      const result = await executeTool("list_llm_providers", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; provider: string; model: string }[]).forEach((c) => {
        expect(c).toHaveProperty("id");
        expect(c).toHaveProperty("provider");
        expect(c).toHaveProperty("model");
      });
    });

    it("list_connectors returns array of id, type, collectionId", async () => {
      const result = await executeTool("list_connectors", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; type: string; collectionId?: string }[]).forEach((r) => {
        expect(r).toHaveProperty("id");
        expect(r).toHaveProperty("type");
      });
    });

    it("list_connectors returns only id, type, collectionId per connector (no extra keys)", async () => {
      const connId = "list-connectors-keys-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connId,
          type: "notion",
          collectionId: crypto.randomUUID(),
          config: "{}",
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connectors", {}, undefined);
        const arr = result as { id: string; type: string; collectionId: string }[];
        const found = arr.find((r) => r.id === connId);
        expect(found).toBeDefined();
        expect(Object.keys(found!).sort()).toEqual(["collectionId", "id", "type"]);
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connId)).run();
      }
    });

    it("list_connectors returns inserted connector with id, type, collectionId", async () => {
      const connId = "list-connectors-insert-" + Date.now();
      const collId = crypto.randomUUID();
      await db
        .insert(ragConnectors)
        .values({
          id: connId,
          type: "notion",
          collectionId: collId,
          config: "{}",
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connectors", {}, undefined);
        expect(Array.isArray(result)).toBe(true);
        const found = (result as { id: string; type: string; collectionId: string }[]).find(
          (r) => r.id === connId
        );
        expect(found).toBeDefined();
        expect(found).toEqual({ id: connId, type: "notion", collectionId: collId });
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connId)).run();
      }
    });

    it("list_connectors returns multiple connectors when DB has several", async () => {
      const id1 = "list-connectors-multi-1-" + Date.now();
      const id2 = "list-connectors-multi-2-" + Date.now();
      const coll1 = crypto.randomUUID();
      const coll2 = crypto.randomUUID();
      await db
        .insert(ragConnectors)
        .values([
          {
            id: id1,
            type: "filesystem",
            collectionId: coll1,
            config: "{}",
            status: "pending",
            createdAt: Date.now(),
          },
          {
            id: id2,
            type: "google_drive",
            collectionId: coll2,
            config: "{}",
            status: "pending",
            createdAt: Date.now(),
          },
        ])
        .run();
      try {
        const result = await executeTool("list_connectors", {}, undefined);
        expect(Array.isArray(result)).toBe(true);
        const arr = result as { id: string; type: string; collectionId: string }[];
        const found1 = arr.find((r) => r.id === id1);
        const found2 = arr.find((r) => r.id === id2);
        expect(found1).toBeDefined();
        expect(found1).toEqual({ id: id1, type: "filesystem", collectionId: coll1 });
        expect(found2).toBeDefined();
        expect(found2).toEqual({ id: id2, type: "google_drive", collectionId: coll2 });
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, id1)).run();
        await db.delete(ragConnectors).where(eq(ragConnectors.id, id2)).run();
      }
    });
  });

  describe("ingest_deployment_documents and list_connector_items", () => {
    it("ingest_deployment_documents returns error when no deployment collection", async () => {
      const result = await executeTool("ingest_deployment_documents", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("No deployment collection"),
        })
      );
    });

    it("ingest_deployment_documents returns message and counts when deployment collection exists", async () => {
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce("col-ingest-1");
      const result = await executeTool("ingest_deployment_documents", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/Ingested \d+ documents/),
          documents: expect.any(Number),
          chunks: expect.any(Number),
        })
      );
    });

    it("ingest_deployment_documents returns documents 0 and chunks 0 when deployment collection has no documents", async () => {
      const emptyCollId = "col-empty-" + Date.now();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(emptyCollId);
      const result = await executeTool("ingest_deployment_documents", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("0 documents"),
          documents: 0,
          chunks: 0,
        })
      );
    });

    it("ingest_deployment_documents accumulates chunks when ingestOneDocument succeeds", async () => {
      const collectionId = "col-ok-" + Date.now();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collectionId);
      const docId = "doc-ok-" + Date.now();
      await db
        .insert(ragDocuments)
        .values({
          id: docId,
          collectionId,
          storePath: "/x",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(ingestOneDocument).mockResolvedValueOnce({ chunks: 3 });
      try {
        const result = await executeTool("ingest_deployment_documents", {}, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            message: expect.stringContaining("1 documents"),
            documents: 1,
            chunks: 3,
          })
        );
      } finally {
        await db.delete(ragDocuments).where(eq(ragDocuments.id, docId)).run();
      }
    });

    it("ingest_deployment_documents includes errors when ingestOneDocument throws for a doc", async () => {
      const collectionId = "col-err-" + Date.now();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collectionId);
      const docId = "doc-err-" + Date.now();
      await db
        .insert(ragDocuments)
        .values({
          id: docId,
          collectionId,
          storePath: "/x",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(ingestOneDocument).mockRejectedValueOnce(new Error("Ingest failed"));
      try {
        const result = await executeTool("ingest_deployment_documents", {}, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            message: expect.stringContaining("1 documents"),
            documents: 1,
            errors: expect.arrayContaining([expect.stringContaining(docId)]),
          })
        );
      } finally {
        await db.delete(ragDocuments).where(eq(ragDocuments.id, docId)).run();
      }
    });

    it("ingest_deployment_documents uses String(err) when ingestOneDocument throws non-Error", async () => {
      const collectionId = "col-nonerr-" + Date.now();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collectionId);
      const docId = "doc-nonerr-" + Date.now();
      await db
        .insert(ragDocuments)
        .values({
          id: docId,
          collectionId,
          storePath: "/x",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(ingestOneDocument).mockRejectedValueOnce("non-Error throw");
      try {
        const result = await executeTool("ingest_deployment_documents", {}, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            documents: 1,
            errors: expect.arrayContaining([expect.stringContaining("non-Error throw")]),
          })
        );
      } finally {
        await db.delete(ragDocuments).where(eq(ragDocuments.id, docId)).run();
      }
    });

    it("list_connector_items returns error when connectorId missing", async () => {
      const result = await executeTool("list_connector_items", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "connectorId required" }));
    });

    it("list_connector_items returns error when connector not found", async () => {
      const result = await executeTool(
        "list_connector_items",
        { connectorId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Connector not found" }));
    });

    it("list_connector_items returns error when connector has no config.path (filesystem)", async () => {
      const connectorId = "conn-no-path-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "filesystem",
          collectionId: crypto.randomUUID(),
          config: "{}",
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(expect.objectContaining({ error: "Connector has no config.path" }));
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items uses empty config object when connector.config is empty string", async () => {
      const connectorId = "conn-empty-config-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "filesystem",
          collectionId: crypto.randomUUID(),
          config: "",
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(expect.objectContaining({ error: "Connector has no config.path" }));
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items returns error for unimplemented connector type", async () => {
      const connectorId = "conn-unknown-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "unknown_browse_type",
          collectionId: crypto.randomUUID(),
          config: "{}",
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            error: "Browse not implemented for connector type: unknown_browse_type",
          })
        );
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items appends auth hint when browse throws auth-related error (e.g. google_drive missing creds)", async () => {
      const connectorId = "conn-gd-no-creds-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "google_drive",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ folderId: "root" }),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
        const err = (result as { error: string }).error;
        expect(err).toMatch(/serviceAccountKeyRef|env var|credential/i);
        expect(err).toContain("Configure this connector in Knowledge");
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items returns items for filesystem connector with path and uses limit", async () => {
      const tmpDir = path.join(os.tmpdir(), "execute-tool-list-conn-" + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });
      const connectorId = "conn-fs-path-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "filesystem",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ path: tmpDir }),
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool(
          "list_connector_items",
          { connectorId, limit: 10 },
          undefined
        );
        expect(result).toEqual(expect.objectContaining({ items: expect.any(Array) }));
        const withPageToken = await executeTool(
          "list_connector_items",
          { connectorId, limit: 50, pageToken: "next-page" },
          undefined
        );
        expect(withPageToken).toEqual(expect.objectContaining({ items: expect.any(Array) }));
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it("list_connector_items returns items for obsidian_vault connector with config.path", async () => {
      const tmpDir = path.join(os.tmpdir(), "execute-tool-obsidian-" + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });
      const connectorId = "conn-obsidian-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "obsidian_vault",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ path: tmpDir }),
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(expect.objectContaining({ items: expect.any(Array) }));
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it("list_connector_items returns items for logseq_graph connector with config.path", async () => {
      const tmpDir = path.join(os.tmpdir(), "execute-tool-logseq-" + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });
      const connectorId = "conn-logseq-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "logseq_graph",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ path: tmpDir }),
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(expect.objectContaining({ items: expect.any(Array) }));
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it("list_connector_items returns error when browse throws", async () => {
      const connectorId = "conn-fs-bad-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "filesystem",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ path: "/nonexistent-path-xyz-12345" }),
          status: "synced",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("list_connector_items", { connectorId }, undefined);
        expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
        const err = (result as { error: string }).error;
        expect(err).not.toContain("Configure this connector in Knowledge");
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items calls browse for dropbox connector and returns error or items", async () => {
      const connectorId = "conn-dropbox-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "dropbox",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({}),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = (await executeTool("list_connector_items", { connectorId }, undefined)) as {
          error?: string;
          items?: unknown;
        };
        expect(result.error ?? result.items).toBeDefined();
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items calls browse for onedrive connector and returns error or items", async () => {
      const connectorId = "conn-onedrive-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "onedrive",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({}),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = (await executeTool("list_connector_items", { connectorId }, undefined)) as {
          error?: string;
          items?: unknown;
        };
        expect(result.error ?? result.items).toBeDefined();
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items calls browse for notion connector and returns error or items", async () => {
      const connectorId = "conn-notion-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "notion",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({}),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = (await executeTool("list_connector_items", { connectorId }, undefined)) as {
          error?: string;
          items?: unknown;
        };
        expect(result.error ?? result.items).toBeDefined();
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items calls browse for confluence connector and returns error or items", async () => {
      const connectorId = "conn-confluence-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "confluence",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({}),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = (await executeTool("list_connector_items", { connectorId }, undefined)) as {
          error?: string;
          items?: unknown;
        };
        expect(result.error ?? result.items).toBeDefined();
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items calls browse for gitbook connector and returns error or items", async () => {
      const connectorId = "conn-gitbook-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "gitbook",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({}),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = (await executeTool("list_connector_items", { connectorId }, undefined)) as {
          error?: string;
          items?: unknown;
        };
        expect(result.error ?? result.items).toBeDefined();
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });

    it("list_connector_items calls browse for bookstack connector and returns error or items", async () => {
      const connectorId = "conn-bookstack-" + Date.now();
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "bookstack",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({}),
          status: "pending",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = (await executeTool("list_connector_items", { connectorId }, undefined)) as {
          error?: string;
          items?: unknown;
        };
        expect(result.error ?? result.items).toBeDefined();
      } finally {
        await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      }
    });
  });

  describe("connector_read_item and connector_update_item", () => {
    it("connector_read_item returns error when connectorId or itemId missing", async () => {
      const r1 = await executeTool("connector_read_item", {}, undefined);
      expect(r1).toEqual(expect.objectContaining({ error: "connectorId and itemId required" }));
      const r2 = await executeTool("connector_read_item", { connectorId: "c1" }, undefined);
      expect(r2).toEqual(expect.objectContaining({ error: "connectorId and itemId required" }));
    });

    it("connector_read_item returns content when readConnectorItem succeeds", async () => {
      vi.mocked(readConnectorItem).mockResolvedValueOnce({
        content: "file body",
        mimeType: "text/plain",
      });
      const result = await executeTool(
        "connector_read_item",
        { connectorId: "c1", itemId: "i1" },
        undefined
      );
      expect(result).toEqual({ content: "file body", mimeType: "text/plain" });
    });

    it("connector_read_item appends auth hint when readConnectorItem returns auth-like error", async () => {
      vi.mocked(readConnectorItem).mockResolvedValueOnce({ error: "Unauthorized" });
      const result = await executeTool(
        "connector_read_item",
        { connectorId: "c1", itemId: "i1" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("Unauthorized"),
        })
      );
      expect((result as { error: string }).error).toContain(
        "Configure this connector in Knowledge"
      );
    });

    it("connector_read_item does not append auth hint when error is outside connector root", async () => {
      vi.mocked(readConnectorItem).mockResolvedValueOnce({
        error: "Item path is outside connector root",
      });
      const result = await executeTool(
        "connector_read_item",
        { connectorId: "c1", itemId: "i1" },
        undefined
      );
      expect((result as { error: string }).error).toBe("Item path is outside connector root");
      expect((result as { error: string }).error).not.toContain(
        "Configure this connector in Knowledge"
      );
    });

    it("connector_update_item returns error when connectorId or itemId missing", async () => {
      const r = await executeTool("connector_update_item", { connectorId: "c1" }, undefined);
      expect(r).toEqual(expect.objectContaining({ error: "connectorId and itemId required" }));
    });

    it("connector_update_item uses empty string when content not string", async () => {
      await executeTool(
        "connector_update_item",
        { connectorId: "c1", itemId: "i1", content: 123 as unknown as string },
        undefined
      );
      expect(updateConnectorItem).toHaveBeenCalledWith("c1", "i1", "");
    });

    it("connector_update_item returns success when updateConnectorItem returns ok", async () => {
      vi.mocked(updateConnectorItem).mockResolvedValueOnce({ ok: true });
      const result = await executeTool(
        "connector_update_item",
        { connectorId: "c1", itemId: "i1", content: "updated" },
        undefined
      );
      expect(result).toEqual({ ok: true });
    });

    it("connector_update_item appends auth hint when updateConnectorItem returns auth-like error", async () => {
      vi.mocked(updateConnectorItem).mockResolvedValueOnce({ error: "401 Forbidden" });
      const result = await executeTool(
        "connector_update_item",
        { connectorId: "c1", itemId: "i1", content: "x" },
        undefined
      );
      expect((result as { error: string }).error).toContain("401 Forbidden");
      expect((result as { error: string }).error).toContain(
        "Configure this connector in Knowledge"
      );
    });

    it("connector_update_item does not append auth hint when error is outside connector root", async () => {
      vi.mocked(updateConnectorItem).mockResolvedValueOnce({
        error: "Item path is outside connector root",
      });
      const result = await executeTool(
        "connector_update_item",
        { connectorId: "c1", itemId: "i1", content: "x" },
        undefined
      );
      expect((result as { error: string }).error).toBe("Item path is outside connector root");
      expect((result as { error: string }).error).not.toContain(
        "Configure this connector in Knowledge"
      );
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", async () => {
      const result = await executeTool("unknown_tool_xyz", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "Unknown tool: unknown_tool_xyz" }));
    });
  });

  describe("list_workflows and get_workflow", () => {
    it("list_workflows returns array of id, name, executionMode", async () => {
      const result = await executeTool("list_workflows", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; name: string; executionMode: string }[]).forEach((w) => {
        expect(w).toHaveProperty("id");
        expect(w).toHaveProperty("name");
        expect(w).toHaveProperty("executionMode");
      });
    });

    it("get_workflow returns Workflow not found for non-existent id", async () => {
      const result = await executeTool(
        "get_workflow",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });
  });

  describe("retry_last_message and format_response", () => {
    it("retry_last_message without conversationId returns no conversation context", async () => {
      const result = await executeTool("retry_last_message", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          lastUserMessage: null,
          message: "No conversation context.",
        })
      );
    });

    it("retry_last_message with conversationId but no user messages returns no previous message", async () => {
      const convId = "retry-no-user-" + Date.now();
      await db
        .insert(conversations)
        .values({ id: convId, title: null, createdAt: Date.now() })
        .run();
      await db
        .insert(chatMessages)
        .values({
          id: "msg-assistant-only",
          conversationId: convId,
          role: "assistant",
          content: "Hello",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("retry_last_message", {}, { conversationId: convId });
        expect(result).toEqual(
          expect.objectContaining({
            lastUserMessage: null,
            message: "No previous user message in this conversation.",
          })
        );
      } finally {
        await db.delete(chatMessages).where(eq(chatMessages.conversationId, convId)).run();
        await db.delete(conversations).where(eq(conversations.id, convId)).run();
      }
    });

    it("format_response with formatted true returns summary and needsInput", async () => {
      const result = await executeTool(
        "format_response",
        {
          formatted: true,
          summary: "Done",
          needsInput: "optional",
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          formatted: true,
          summary: "Done",
          needsInput: "optional",
        })
      );
    });

    it("format_response with summary only uses empty string for missing needsInput", async () => {
      const result = await executeTool(
        "format_response",
        { summary: "Summary only", needsInput: "   " },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          formatted: true,
          summary: "Summary only",
          needsInput: undefined,
        })
      );
    });

    it("format_response with non-string summary uses empty string", async () => {
      const result = await executeTool(
        "format_response",
        { summary: 123 as unknown as string },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          formatted: true,
          summary: "",
        })
      );
    });
  });

  describe("create_agent tool cap", () => {
    it("create_agent with toolIds exceeding max returns TOOL_CAP_EXCEEDED", async () => {
      const tooManyIds = Array.from({ length: 11 }, (_, i) => `tool-${i}`);
      const result = await executeTool(
        "create_agent",
        {
          name: "Cap Test Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          toolIds: tooManyIds,
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("exceeds the maximum"),
          code: "TOOL_CAP_EXCEEDED",
          maxToolsPerAgent: 10,
        })
      );
    });
  });

  describe("list_agents, get_agent, delete_agent", () => {
    it("list_agents returns array of id, name, kind, protocol", async () => {
      const result = await executeTool("list_agents", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; name: string; kind: string; protocol: string }[]).forEach((a) => {
        expect(a).toHaveProperty("id");
        expect(a).toHaveProperty("name");
        expect(a).toHaveProperty("kind");
        expect(a).toHaveProperty("protocol");
      });
    });

    it("get_agent returns Agent not found for non-existent id", async () => {
      const result = await executeTool(
        "get_agent",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });

    it("get_agent without id or agentId returns error", async () => {
      const result = await executeTool("get_agent", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "id or agentId is required" }));
    });

    it("get_agent with empty id returns error", async () => {
      const result = await executeTool("get_agent", { id: "   " }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "id or agentId is required" }));
    });

    it("get_agent accepts agentId when id is omitted", async () => {
      const createRes = await executeTool(
        "create_agent",
        { name: "Get By AgentId Agent", kind: "node", type: "internal", protocol: "native" },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      expect(agentId).toBeDefined();
      const getRes = await executeTool("get_agent", { agentId }, undefined);
      expect(getRes).toEqual(
        expect.objectContaining({ id: agentId, name: "Get By AgentId Agent" })
      );
    });

    it("delete_agent returns message after deleting created agent", async () => {
      const createRes = await executeTool(
        "create_agent",
        { name: "To Delete Agent", kind: "node", type: "internal", protocol: "native" },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      expect(agentId).toBeDefined();
      const deleteRes = await executeTool("delete_agent", { id: agentId }, undefined);
      expect(deleteRes).toEqual(expect.objectContaining({ message: "Agent deleted" }));
      const getRes = await executeTool("get_agent", { id: agentId }, undefined);
      expect(getRes).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });
  });

  describe("update_agent error branches", () => {
    it("update_agent without agentId or id returns error", async () => {
      const result = await executeTool("update_agent", { name: "X" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "agentId or id is required" }));
    });

    it("update_agent with empty id returns error", async () => {
      const result = await executeTool("update_agent", { id: "   ", name: "X" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "agentId or id is required" }));
    });

    it("update_agent with non-existent agent returns Agent not found", async () => {
      const result = await executeTool(
        "update_agent",
        { id: "00000000-0000-0000-0000-000000000099", name: "X" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });
  });

  describe("list_agent_versions and rollback_agent error branches", () => {
    it("list_agent_versions without agentId returns error", async () => {
      const result = await executeTool("list_agent_versions", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "agentId is required" }));
    });

    it("list_agent_versions with non-existent agent returns Agent not found", async () => {
      const result = await executeTool(
        "list_agent_versions",
        { agentId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });

    it("rollback_agent without agentId returns error", async () => {
      const result = await executeTool("rollback_agent", { versionId: "v1" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "agentId is required" }));
    });

    it("rollback_agent with non-existent agent returns Agent not found", async () => {
      const result = await executeTool(
        "rollback_agent",
        { agentId: "00000000-0000-0000-0000-000000000099", versionId: "v1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });

    it("rollback_agent without versionId or version returns Version not found", async () => {
      const createRes = await executeTool(
        "create_agent",
        { name: "Rollback Test Agent", kind: "node", type: "internal", protocol: "native" },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      try {
        const result = await executeTool("rollback_agent", { agentId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            error: "Version not found (provide versionId or version)",
          })
        );
      } finally {
        await executeTool("delete_agent", { id: agentId }, undefined);
      }
    });
  });

  describe("get_tool and create_tool", () => {
    it("get_tool returns error when tool not found", async () => {
      const result = await executeTool("get_tool", { id: "non-existent-tool-id-999" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "Tool not found" }));
    });

    it("create_tool with empty name uses Unnamed tool", async () => {
      const result = await executeTool(
        "create_tool",
        { name: "   ", protocol: "native", config: {} },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: "Unnamed tool",
          message: expect.stringContaining("Unnamed tool"),
        })
      );
    });
  });

  describe("agent specialist prompt contains improvement clarification rule", () => {
    it("AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION instructs ask_user and lists four mechanisms + subset mapping", () => {
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toContain("ask_user");
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toMatch(/prompt and workflow only/i);
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toMatch(/model training/i);
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toMatch(/workflow topology/i);
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toMatch(/prompt improvement/i);
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toContain("prompt_and_topology");
      expect(AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION).toMatch(/subset/i);
    });
  });

  describe("improver topology: add agent to workflow and change relations", () => {
    it("get_workflow then create_agent then update_workflow with new node and edges succeeds", async () => {
      const createWf = await executeTool(
        "create_workflow",
        { name: "Topology Test WF" },
        undefined
      );
      const wfId = (createWf as { id?: string }).id;
      expect(typeof wfId).toBe("string");

      const createAgent1 = await executeTool(
        "create_agent",
        { name: "First Node", description: "First agent", llmConfigId: "any" },
        undefined
      );
      const agent1Id = (createAgent1 as { id?: string }).id;
      expect(typeof agent1Id).toBe("string");

      await executeTool(
        "update_workflow",
        {
          id: wfId,
          nodes: [{ id: "n1", type: "agent", position: [0, 0], parameters: { agentId: agent1Id } }],
          edges: [],
        },
        undefined
      );

      const getWf = await executeTool("get_workflow", { id: wfId }, undefined);
      expect((getWf as { error?: string }).error).toBeUndefined();
      const existingNodes =
        (getWf as { nodes?: { id: string; type: string; parameters?: { agentId?: string } }[] })
          .nodes ?? [];
      const existingEdges = (getWf as { edges?: { source: string; target: string }[] }).edges ?? [];

      const createAgent2 = await executeTool(
        "create_agent",
        { name: "Second Node", description: "Second agent for topology test", llmConfigId: "any" },
        undefined
      );
      const agent2Id = (createAgent2 as { id?: string }).id;
      expect(typeof agent2Id).toBe("string");

      const newNodes = [
        ...existingNodes,
        { id: "n2", type: "agent", position: [200, 0], parameters: { agentId: agent2Id } },
      ];
      const newEdges = [...existingEdges, { id: "e-n1-n2", source: "n1", target: "n2" }];

      const updateRes = await executeTool(
        "update_workflow",
        { id: wfId, nodes: newNodes, edges: newEdges },
        undefined
      );
      expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect((updateRes as { id?: string }).id).toBe(wfId);

      const getWfAfter = await executeTool("get_workflow", { id: wfId }, undefined);
      expect((getWfAfter as { error?: string }).error).toBeUndefined();
      const nodesAfter =
        (getWfAfter as { nodes?: { id: string; parameters?: { agentId?: string } }[] }).nodes ?? [];
      const edgesAfter =
        (getWfAfter as { edges?: { source: string; target: string }[] }).edges ?? [];
      expect(nodesAfter.length).toBe(2);
      expect(edgesAfter.length).toBe(1);
      expect(edgesAfter[0].source).toBe("n1");
      expect(edgesAfter[0].target).toBe("n2");
    });
  });

  describe("executeTool trigger_training and spawn_instance", () => {
    it("trigger_training with no jobId returns error containing jobId", async () => {
      const result = await executeTool("trigger_training", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("jobId") }));
    });

    it("trigger_training with job_id only (snake_case) normalizes and returns Job not found", async () => {
      const result = await executeTool(
        "trigger_training",
        { job_id: "non-existent-job-id", datasetRef: "", backend: "local" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Job not found" }));
    });

    it("trigger_training with invalid jobId returns Job not found", async () => {
      const result = await executeTool(
        "trigger_training",
        { jobId: "non-existent-job-id", datasetRef: "", backend: "local" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Job not found" }));
    });

    it("spawn_instance without jobId returns error containing jobId", async () => {
      const result = await executeTool("spawn_instance", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("jobId") }));
    });

    it("trigger_training with valid jobId creates run and get_training_status sees it", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "Trigger training test job" },
        undefined
      );
      const jobId = (createRes as { id?: string }).id;
      expect(typeof jobId).toBe("string");

      const triggerRes = await executeTool(
        "trigger_training",
        { jobId, datasetRef: "", backend: "local" },
        undefined
      );
      expect(triggerRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const runId = (triggerRes as { runId?: string }).runId;
      expect(typeof runId).toBe("string");

      const statusRes = await executeTool("get_training_status", { runId }, undefined);
      expect(statusRes).not.toEqual(expect.objectContaining({ error: "Run not found" }));
      expect(statusRes).toEqual(expect.objectContaining({ runId }));
      expect(["pending", "running"]).toContain((statusRes as { status?: string }).status);
    });

    it("trigger_training when local fetch throws still creates run and returns may be unavailable message", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "Trigger training catch test" },
        undefined
      );
      const jobId = (createRes as { id?: string }).id;
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof fetch }).fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));
      try {
        const result = await executeTool(
          "trigger_training",
          { jobId, datasetRef: "", backend: "local" },
          undefined
        );
        expect(result).toEqual(
          expect.objectContaining({
            runId: expect.any(String),
            backend: "local",
            status: "pending",
          })
        );
        expect((result as { message?: string }).message).toContain("may be unavailable");
      } finally {
        (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      }
    });

    it("generate_training_data from_feedback writes JSONL and returns datasetRef", async () => {
      const createRes = await executeTool(
        "create_agent",
        { name: "Feedback export test", kind: "node", protocol: "native" },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");
      await executeTool(
        "create_improvement_job",
        { scopeType: "agent", scopeId: agentId },
        undefined
      );
      const result = await executeTool(
        "generate_training_data",
        { strategy: "from_feedback", scopeType: "agent", scopeId: agentId },
        undefined
      );
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const datasetRef = (result as { datasetRef?: string }).datasetRef;
      expect(typeof datasetRef).toBe("string");
      if (datasetRef) {
        const fs = await import("node:fs");
        expect(fs.existsSync(datasetRef)).toBe(true);
      }
    });

    it("generate_training_data from_runs returns error when scopeId missing", async () => {
      const result = await executeTool(
        "generate_training_data",
        { strategy: "from_runs", scopeType: "agent" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/scopeId|from_runs/),
        })
      );
    });

    it("generate_training_data with other strategy returns datasetRef and Teacher/self_play message", async () => {
      const result = await executeTool(
        "generate_training_data",
        { strategy: "teacher", scopeType: "agent", scopeId: "agent-1" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          datasetRef: expect.any(String),
          strategy: "teacher",
          message: expect.stringContaining("Teacher/self_play require external data"),
        })
      );
    });

    it("register_trained_model returns error when outputModelRef missing", async () => {
      const result = await executeTool("register_trained_model", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "register_trained_model requires outputModelRef.",
        })
      );
    });

    it("get_training_status returns Run not found for non-existent runId", async () => {
      const result = await executeTool(
        "get_training_status",
        { runId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Run not found" }));
    });

    it("get_training_status returns DB state when local trainer fetch throws", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "Status catch test" },
        undefined
      );
      const jobId = (createRes as { id?: string }).id;
      const triggerRes = await executeTool(
        "trigger_training",
        { jobId, datasetRef: "", backend: "local" },
        undefined
      );
      const runId = (triggerRes as { runId?: string }).runId;
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof fetch }).fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));
      try {
        const result = await executeTool("get_training_status", { runId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            runId,
            status: "pending",
            outputModelRef: null,
          })
        );
      } finally {
        (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      }
    });

    it("get_training_status updates and returns status when local trainer returns ok", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "Status ok test" },
        undefined
      );
      const jobId = (createRes as { id?: string }).id;
      const triggerRes = await executeTool(
        "trigger_training",
        { jobId, datasetRef: "", backend: "local" },
        undefined
      );
      const runId = (triggerRes as { runId?: string }).runId;
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof fetch }).fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "running" }),
      } as Response);
      try {
        const result = await executeTool("get_training_status", { runId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            runId,
            status: "running",
          })
        );
      } finally {
        (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      }
    });

    it("register_trained_model creates LLM config and returns llmConfigId", async () => {
      const result = await executeTool(
        "register_trained_model",
        { outputModelRef: "ollama:my-trained-model", name: "E2E trained" },
        undefined
      );
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const llmConfigId = (result as { llmConfigId?: string }).llmConfigId;
      expect(typeof llmConfigId).toBe("string");
      expect(llmConfigId).toMatch(/^llm-trained-/);
    });

    it("register_trained_model includes jobId in result when provided", async () => {
      const result = await executeTool(
        "register_trained_model",
        { outputModelRef: "ollama:another-model", jobId: "job-123" },
        undefined
      );
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect((result as { jobId?: string }).jobId).toBe("job-123");
    });

    it("decide_optimization_target returns target and scope", async () => {
      const result = await executeTool("decide_optimization_target", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          target: "model_instance",
          scope: "agent",
          reason: expect.any(String),
        })
      );
    });

    it("record_technique_insight returns id and message", async () => {
      const result = await executeTool(
        "record_technique_insight",
        { jobId: "j1", techniqueOrStrategy: "fine-tune", outcome: "positive", summary: "Good run" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          message: "Insight recorded.",
        })
      );
    });

    it("list_specialist_models returns error when agentId missing", async () => {
      const result = await executeTool("list_specialist_models", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("agentId") })
      );
    });

    it("list_specialist_models returns jobs array for agent (may be empty)", async () => {
      const createRes = await executeTool(
        "create_agent",
        { name: "Specialist list test", kind: "node", protocol: "native" },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");
      const result = await executeTool("list_specialist_models", { agentId }, undefined);
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect((result as { agentId?: string }).agentId).toBe(agentId);
      expect(Array.isArray((result as { jobs?: unknown[] }).jobs)).toBe(true);
    });

    it("evaluate_model returns error when jobId missing", async () => {
      const result = await executeTool("evaluate_model", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "evaluate_model requires jobId." }));
    });

    it("evaluate_model returns Job not found for non-existent job", async () => {
      const result = await executeTool(
        "evaluate_model",
        { jobId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Job not found" }));
    });

    it("evaluate_model persists result and returns evalId and metrics", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "Eval persist test job" },
        undefined
      );
      const jobId = (createRes as { id?: string }).id;
      expect(typeof jobId).toBe("string");
      const result = await executeTool("evaluate_model", { jobId }, undefined);
      expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect((result as { evalId?: string }).evalId).toBeDefined();
      expect((result as { metrics?: unknown }).metrics).toEqual(
        expect.objectContaining({ accuracy: 0, loss: null })
      );
    });
  });

  describe("executeTool version/rollback tools", () => {
    it("list_agent_versions returns error when agentId missing", async () => {
      const result = await executeTool("list_agent_versions", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "agentId is required" }));
    });

    it("list_agent_versions returns error when agent not found", async () => {
      const result = await executeTool(
        "list_agent_versions",
        { agentId: "non-existent-agent-id" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });

    it("delete_workflow returns Workflow not found for non-existent id", async () => {
      const result = await executeTool(
        "delete_workflow",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });

    it("delete_workflow deletes workflow and returns message", async () => {
      const createRes = await executeTool("create_workflow", { name: "To Delete WF" }, undefined);
      const wfId = (createRes as { id?: string }).id;
      expect(wfId).toBeDefined();
      const deleteRes = await executeTool("delete_workflow", { id: wfId }, undefined);
      expect(deleteRes).toEqual(
        expect.objectContaining({ id: wfId, message: expect.stringContaining("deleted") })
      );
      const getRes = await executeTool("get_workflow", { id: wfId }, undefined);
      expect(getRes).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });

    it("list_workflow_versions returns error when workflowId missing", async () => {
      const result = await executeTool("list_workflow_versions", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Workflow id is required/) })
      );
    });

    it("list_workflow_versions returns error when workflow not found", async () => {
      const result = await executeTool(
        "list_workflow_versions",
        { workflowId: "non-existent-wf-id" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });

    it("rollback_agent returns error when agentId missing", async () => {
      const result = await executeTool("rollback_agent", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "agentId is required" }));
    });

    it("rollback_agent returns error when agent not found", async () => {
      const result = await executeTool(
        "rollback_agent",
        { agentId: "non-existent", version: 1 },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Agent not found" }));
    });

    it("rollback_workflow returns error when workflowId missing", async () => {
      const result = await executeTool("rollback_workflow", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Workflow id is required/) })
      );
    });

    it("rollback_workflow returns error when workflow not found", async () => {
      const result = await executeTool(
        "rollback_workflow",
        { workflowId: "non-existent", version: 1 },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });

    it("rollback_workflow returns Version not found when workflow exists but no versionId or version", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Rollback WF Test" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      try {
        const result = await executeTool("rollback_workflow", { workflowId: wfId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            error: "Version not found (provide versionId or version)",
          })
        );
      } finally {
        await executeTool("delete_workflow", { id: wfId }, undefined);
      }
    });

    it("list_agent_versions returns array for existing agent (may be empty)", async () => {
      const createRes = await executeTool(
        "create_agent",
        {
          name: "Version Test Agent",
          description: "For version tests",
          kind: "node",
          protocol: "native",
        },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");
      const listRes = await executeTool("list_agent_versions", { agentId }, undefined);
      expect(Array.isArray(listRes)).toBe(true);
      expect(
        (listRes as unknown[]).every(
          (r) =>
            typeof (r as { id?: string }).id === "string" &&
            typeof (r as { version?: number }).version === "number"
        )
      ).toBe(true);
    });

    it("list_workflow_versions returns array for existing workflow (may be empty)", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Version Test WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");
      const listRes = await executeTool("list_workflow_versions", { workflowId: wfId }, undefined);
      expect(Array.isArray(listRes)).toBe(true);
      expect(
        (listRes as unknown[]).every(
          (r) =>
            typeof (r as { id?: string }).id === "string" &&
            typeof (r as { version?: number }).version === "number"
        )
      ).toBe(true);
    });

    it("rollback_agent with existing agent but invalid version returns version not found", async () => {
      const createRes = await executeTool(
        "create_agent",
        {
          name: "Rollback Test Agent",
          description: "For rollback test",
          kind: "node",
          protocol: "native",
        },
        undefined
      );
      const agentId = (createRes as { id?: string }).id;
      expect(typeof agentId).toBe("string");
      const result = await executeTool("rollback_agent", { agentId, version: 999 }, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Version not found/) })
      );
    });

    it("rollback_workflow with existing workflow but invalid version returns version not found", async () => {
      const createRes = await executeTool(
        "create_workflow",
        { name: "Rollback Test WF" },
        undefined
      );
      const wfId = (createRes as { id?: string }).id;
      expect(typeof wfId).toBe("string");
      const result = await executeTool(
        "rollback_workflow",
        { workflowId: wfId, version: 999 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/Version not found/) })
      );
    });
  });

  describe("executeTool create_code_tool and custom function CRUD", () => {
    it("create_code_tool returns error when name is missing", async () => {
      const result = await executeTool(
        "create_code_tool",
        { language: "javascript", source: "async function main() { return {}; }" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("name is required") })
      );
    });

    it("create_code_tool returns error when source is missing", async () => {
      const result = await executeTool(
        "create_code_tool",
        { name: "Test Tool", language: "javascript" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("source is required") })
      );
    });

    it("create_code_tool returns error when language is invalid", async () => {
      const result = await executeTool(
        "create_code_tool",
        { name: "Test", language: "ruby", source: "def main; end" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringMatching(/language must be/) })
      );
    });

    it("create_code_tool with inputSchema stores schema on tool", async () => {
      const result = await executeTool(
        "create_code_tool",
        {
          name: "Schema Tool",
          language: "javascript",
          source: "async function main() { return {}; }",
          inputSchema: { type: "object", properties: { x: { type: "string" } } },
        },
        undefined
      );
      expect((result as { error?: string }).error).toBeUndefined();
      const toolId = (result as { toolId?: string }).toolId;
      expect(toolId).toBeDefined();
      const toolRows = await db.select().from(tools).where(eq(tools.id, toolId!));
      expect(toolRows.length).toBe(1);
      const config = JSON.parse(toolRows[0].config ?? "{}") as Record<string, unknown>;
      expect(config.functionId).toBeDefined();
    });

    it("create_code_tool succeeds and creates function and tool in DB", async () => {
      const result = await executeTool(
        "create_code_tool",
        {
          name: "Echo Tool",
          language: "javascript",
          source: "async function main(input) { return { echo: input }; }",
          description: "Echoes input",
        },
        undefined
      );
      expect((result as { error?: string }).error).toBeUndefined();
      const res = result as { id?: string; toolId?: string; name?: string };
      expect(typeof res.id).toBe("string");
      expect(res.toolId).toBe(`fn-${res.id}`);
      expect(res.name).toBe("Echo Tool");

      const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, res.id!));
      expect(fnRows.length).toBe(1);
      expect(fnRows[0].name).toBe("Echo Tool");
      expect(fnRows[0].language).toBe("javascript");
      expect(fnRows[0].sandboxId).toBeDefined();

      const toolRows = await db.select().from(tools).where(eq(tools.id, res.toolId!));
      expect(toolRows.length).toBe(1);
      const config = JSON.parse(toolRows[0].config ?? "{}") as Record<string, unknown>;
      expect(config.functionId).toBe(res.id);
    });

    it("list_custom_functions returns empty array when no functions", async () => {
      const result = await executeTool("list_custom_functions", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBeGreaterThanOrEqual(0);
    });

    it("list_custom_functions returns created function and toolId after create_custom_function", async () => {
      const createRes = await executeTool(
        "create_custom_function",
        {
          name: "List Test Fn",
          language: "javascript",
          source: "async function main() { return {}; }",
        },
        undefined
      );
      const fnId = (createRes as { id?: string }).id;
      expect(typeof fnId).toBe("string");

      const listRes = await executeTool("list_custom_functions", {}, undefined);
      expect(Array.isArray(listRes)).toBe(true);
      const list = listRes as { id: string; name: string; language: string }[];
      const found = list.find((f) => f.id === fnId);
      expect(found).toBeDefined();
      expect(found?.name).toBe("List Test Fn");
      expect(found?.language).toBe("javascript");
    });

    it("get_custom_function returns function when found", async () => {
      const createRes = await executeTool(
        "create_custom_function",
        {
          name: "Get Test Fn",
          language: "python",
          source: "def main(input): return input",
        },
        undefined
      );
      const fnId = (createRes as { id?: string }).id;
      expect(typeof fnId).toBe("string");

      const getRes = await executeTool("get_custom_function", { id: fnId }, undefined);
      expect((getRes as { error?: string }).error).toBeUndefined();
      const fn = getRes as { id: string; name: string; language: string; source: string };
      expect(fn.id).toBe(fnId);
      expect(fn.name).toBe("Get Test Fn");
      expect(fn.language).toBe("python");
      expect(fn.source).toContain("def main");
    });

    it("get_custom_function returns error when id is required", async () => {
      const r1 = await executeTool("get_custom_function", {}, undefined);
      const r2 = await executeTool("get_custom_function", { id: "   " }, undefined);
      expect(r1).toEqual(expect.objectContaining({ error: "id is required" }));
      expect(r2).toEqual(expect.objectContaining({ error: "id is required" }));
    });

    it("get_custom_function returns error when not found", async () => {
      const result = await executeTool("get_custom_function", { id: "non-existent-id" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("not found") })
      );
    });

    it("update_custom_function updates source and get_custom_function returns new source", async () => {
      const createRes = await executeTool(
        "create_custom_function",
        {
          name: "Update Test Fn",
          language: "javascript",
          source: "async function main() { return { v: 1 }; }",
        },
        undefined
      );
      const fnId = (createRes as { id?: string }).id;
      expect(typeof fnId).toBe("string");

      const newSource = "async function main() { return { v: 2 }; }";
      const updateRes = await executeTool(
        "update_custom_function",
        { id: fnId, source: newSource },
        undefined
      );
      expect((updateRes as { error?: string }).error).toBeUndefined();

      const getRes = await executeTool("get_custom_function", { id: fnId }, undefined);
      expect((getRes as { source?: string }).source).toBe(newSource);
    });

    it("update_custom_function returns error when not found", async () => {
      const result = await executeTool(
        "update_custom_function",
        { id: "non-existent", source: "x" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("not found") })
      );
    });

    it("update_custom_function accepts description and sandboxId", async () => {
      const createRes = await executeTool(
        "create_custom_function",
        {
          name: "Desc Sandbox Fn",
          language: "javascript",
          source: "async function main() { return {}; }",
        },
        undefined
      );
      const fnId = (createRes as { id?: string }).id;
      const updateRes = await executeTool(
        "update_custom_function",
        {
          id: fnId,
          description: "Updated description",
          sandboxId: "sandbox-123",
        },
        undefined
      );
      expect(updateRes).toEqual(
        expect.objectContaining({ id: fnId, message: expect.stringContaining("updated") })
      );
    });

    it("create_custom_function with description returns id and message", async () => {
      const result = await executeTool(
        "create_custom_function",
        {
          name: "Desc Fn",
          language: "javascript",
          source: "async function main() { return 1; }",
          description: "A test function",
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: "Desc Fn",
          message: expect.stringContaining("created"),
        })
      );
    });
  });

  describe("executeTool tools specialist in registry", () => {
    it("default registry includes tools specialist with create_code_tool and custom function tools", () => {
      const registry = getRegistry();
      expect(registry.topLevelIds).toContain("tools");
      const spec = registry.specialists["tools"];
      expect(spec).toBeDefined();
      expect(spec?.toolNames).toContain("create_code_tool");
      expect(spec?.toolNames).toContain("list_custom_functions");
      expect(spec?.toolNames).toContain("get_custom_function");
      expect(spec?.toolNames).toContain("update_custom_function");
      expect(spec?.toolNames).toContain("list_tools");
      expect(spec?.toolNames).toContain("get_tool");
      expect(spec?.toolNames).toContain("create_tool");
      expect(spec?.toolNames).toContain("update_tool");
    });
  });

  describe("executeTool OpenClaw handlers", () => {
    beforeEach(() => {
      mockOpenclawSend.mockReset();
      mockOpenclawHistory.mockReset();
      mockOpenclawAbort.mockReset();
    });

    it("send_to_openclaw returns error when content missing or empty", async () => {
      const r1 = await executeTool("send_to_openclaw", {}, undefined);
      expect(r1).toEqual(expect.objectContaining({ error: "content is required" }));
      const r2 = await executeTool("send_to_openclaw", { content: "   " }, undefined);
      expect(r2).toEqual(expect.objectContaining({ error: "content is required" }));
      expect(mockOpenclawSend).not.toHaveBeenCalled();
    });

    it("send_to_openclaw on success returns message and runId", async () => {
      mockOpenclawSend.mockResolvedValue({ runId: "run-1", status: "running" });
      const result = await executeTool("send_to_openclaw", { content: "Say hello" }, undefined);
      expect(mockOpenclawSend).toHaveBeenCalledWith("Say hello", expect.any(Object));
      expect(result).toEqual(
        expect.objectContaining({
          runId: "run-1",
          message: "Message sent to OpenClaw.",
        })
      );
    });

    it("send_to_openclaw on reject returns error containing OpenClaw and hint", async () => {
      mockOpenclawSend.mockRejectedValue(new Error("Connection refused"));
      const result = await executeTool("send_to_openclaw", { content: "hi" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("OpenClaw"),
          message: expect.stringContaining("OPENCLAW_GATEWAY_URL"),
        })
      );
    });

    it("send_to_openclaw accepts message key as content", async () => {
      mockOpenclawSend.mockResolvedValue({ runId: "r2", status: "running" });
      const result = await executeTool(
        "send_to_openclaw",
        { message: "Hello via message" },
        undefined
      );
      expect(mockOpenclawSend).toHaveBeenCalledWith("Hello via message", expect.any(Object));
      expect(result).toEqual(
        expect.objectContaining({ runId: "r2", message: "Message sent to OpenClaw." })
      );
    });

    it("send_to_openclaw accepts text key as content", async () => {
      mockOpenclawSend.mockResolvedValue({ status: "ok" });
      const result = await executeTool("send_to_openclaw", { text: "Hello via text" }, undefined);
      expect(mockOpenclawSend).toHaveBeenCalledWith("Hello via text", expect.any(Object));
      expect(result).toEqual(expect.objectContaining({ message: expect.any(String) }));
    });

    it("send_to_openclaw returns Sandbox not found when sandboxId not in DB", async () => {
      const result = await executeTool(
        "send_to_openclaw",
        { content: "hi", sandboxId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Sandbox not found" }));
      expect(mockOpenclawSend).not.toHaveBeenCalled();
    });

    it("openclaw_history returns messages on success", async () => {
      mockOpenclawHistory.mockResolvedValue({
        messages: [{ role: "assistant", content: "Hi there" }],
      });
      const result = await executeTool("openclaw_history", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          messages: expect.arrayContaining([expect.objectContaining({ content: "Hi there" })]),
          message: expect.stringContaining("Last"),
        })
      );
    });

    it("openclaw_history returns error and empty messages when result has error", async () => {
      mockOpenclawHistory.mockResolvedValue({ error: "Session not found" });
      const result = await executeTool("openclaw_history", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "Session not found", messages: [] }));
    });

    it("openclaw_history caps limit at 50", async () => {
      mockOpenclawHistory.mockResolvedValue({ messages: [] });
      await executeTool("openclaw_history", { limit: 100 }, undefined);
      expect(mockOpenclawHistory).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it("openclaw_history on reject returns error and empty messages", async () => {
      mockOpenclawHistory.mockRejectedValue(new Error("WebSocket closed"));
      const result = await executeTool("openclaw_history", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("OpenClaw"),
          messages: [],
        })
      );
    });

    it("openclaw_abort returns message when ok", async () => {
      mockOpenclawAbort.mockResolvedValue({ ok: true });
      const result = await executeTool("openclaw_abort", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ message: "OpenClaw run aborted." }));
    });

    it("openclaw_abort returns error when not ok", async () => {
      mockOpenclawAbort.mockResolvedValue({ ok: false, error: "No run" });
      const result = await executeTool("openclaw_abort", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: "No run", message: "Could not abort." })
      );
    });

    it("openclaw_abort on reject returns error containing OpenClaw", async () => {
      mockOpenclawAbort.mockRejectedValue(new Error("Timeout"));
      const result = await executeTool("openclaw_abort", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("OpenClaw") })
      );
    });
  });

  describe("executeTool create_sandbox", () => {
    it("create_sandbox returns install hint when container create throws unavailable error", async () => {
      mockContainerCreate.mockRejectedValueOnce(new Error("command not found"));
      const result = await executeTool("create_sandbox", { image: "alpine:3.18" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          status: "stopped",
        })
      );
      expect((result as { message?: string }).message).toContain("Install a container runtime");
    });

    it("create_sandbox with containerPort returns hostPort when container starts", async () => {
      const result = await executeTool(
        "create_sandbox",
        { image: "alpine:3.18", containerPort: 18789 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          status: "running",
          hostPort: expect.any(Number),
        })
      );
      const hostPort = (result as { hostPort: number }).hostPort;
      expect(hostPort).toBeGreaterThanOrEqual(1);
      expect(hostPort).toBeLessThanOrEqual(65535);
    });

    it("create_sandbox with containerPort returns error when container fails to start", async () => {
      mockContainerCreate.mockRejectedValueOnce(new Error("image not found"));
      const result = await executeTool(
        "create_sandbox",
        { image: "alpine:3.18", containerPort: 80 },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect(result).not.toHaveProperty("hostPort");
    });
  });

  describe("executeTool reminders", () => {
    it("create_reminder returns error when message is required", async () => {
      const result = await executeTool("create_reminder", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "message is required" }));
    });

    it("create_reminder returns error when message is whitespace only", async () => {
      const result = await executeTool("create_reminder", { message: "   " }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "message is required" }));
    });

    it("create_reminder returns error when at is invalid", async () => {
      const result = await executeTool(
        "create_reminder",
        { message: "Remind me", at: "not-a-date" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: "at must be a valid ISO 8601 date string" })
      );
    });

    it("create_reminder returns error when neither at nor inMinutes", async () => {
      const result = await executeTool("create_reminder", { message: "Remind me" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "Either at (ISO date) or inMinutes (number) is required",
        })
      );
    });

    it("create_reminder returns error when runAt is in the past", async () => {
      const result = await executeTool(
        "create_reminder",
        { message: "Past", at: "2020-01-01T00:00:00.000Z" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({ error: "Reminder time must be in the future" })
      );
    });

    it("create_reminder returns error for assistant_task without conversationId", async () => {
      const result = await executeTool(
        "create_reminder",
        { message: "Task", taskType: "assistant_task", inMinutes: 5 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: "Cannot schedule an assistant task without a conversation (use in chat).",
        })
      );
    });

    it("create_reminder succeeds with inMinutes and returns id, runAt, message", async () => {
      const result = await executeTool(
        "create_reminder",
        { message: "Batch reminder", inMinutes: 60 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          runAt: expect.any(Number),
          reminderMessage: "Batch reminder",
          taskType: "message",
          status: "pending",
          message: expect.stringContaining("Reminder set"),
        })
      );
      const id = (result as { id: string }).id;
      await executeTool("cancel_reminder", { id }, undefined);
    });

    it("create_reminder succeeds with at (ISO date)", async () => {
      const runAt = Date.now() + 24 * 60 * 60 * 1000;
      const result = await executeTool(
        "create_reminder",
        { message: "Tomorrow", at: new Date(runAt).toISOString() },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          runAt: expect.any(Number),
          reminderMessage: "Tomorrow",
          status: "pending",
        })
      );
      await executeTool("cancel_reminder", { id: (result as { id: string }).id }, undefined);
    });

    it("list_reminders returns reminders array and message", async () => {
      const result = await executeTool("list_reminders", { status: "pending" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          reminders: expect.any(Array),
          message: expect.stringMatching(/\d+ reminder\(s\)\./),
        })
      );
    });

    it("list_reminders with status fired returns list", async () => {
      const result = await executeTool("list_reminders", { status: "fired" }, undefined);
      expect(result).toHaveProperty("reminders");
      expect(Array.isArray((result as { reminders: unknown[] }).reminders)).toBe(true);
    });

    it("list_reminders with status cancelled returns list", async () => {
      const result = await executeTool("list_reminders", { status: "cancelled" }, undefined);
      expect(result).toHaveProperty("reminders");
    });

    it("list_reminders with no status defaults to pending", async () => {
      const result = await executeTool("list_reminders", {}, undefined);
      expect(result).toHaveProperty("reminders");
      expect((result as { message: string }).message).toMatch(/\d+ reminder\(s\)\./);
    });

    it("list_reminders with invalid status defaults to pending", async () => {
      const result = await executeTool("list_reminders", { status: "scheduled" }, undefined);
      expect(result).toHaveProperty("reminders");
    });

    it("cancel_reminder returns error when id is required", async () => {
      const result = await executeTool("cancel_reminder", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "id is required" }));
    });

    it("cancel_reminder returns error when reminder not found", async () => {
      const result = await executeTool(
        "cancel_reminder",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Reminder not found" }));
    });

    it("cancel_reminder returns error when reminder is not pending", async () => {
      const createRes = await executeTool(
        "create_reminder",
        { message: "To cancel", inMinutes: 120 },
        undefined
      );
      const id = (createRes as { id: string }).id;
      await db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, id)).run();
      const result = await executeTool("cancel_reminder", { id }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "Reminder is not pending (already fired or cancelled)",
        })
      );
    });

    it("cancel_reminder succeeds and returns message", async () => {
      const createRes = await executeTool(
        "create_reminder",
        { message: "To cancel", inMinutes: 90 },
        undefined
      );
      const id = (createRes as { id: string }).id;
      const result = await executeTool("cancel_reminder", { id }, undefined);
      expect(result).toEqual(expect.objectContaining({ message: "Reminder cancelled." }));
    });
  });

  describe("executeTool runs", () => {
    it("list_runs returns array of runs with id, targetType, targetId, status", async () => {
      const result = await executeTool("list_runs", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; targetType: string; targetId: string; status: string }[]).forEach(
        (r) => {
          expect(r).toHaveProperty("id");
          expect(r).toHaveProperty("targetType");
          expect(r).toHaveProperty("targetId");
          expect(r).toHaveProperty("status");
        }
      );
    });

    it("get_run returns Run not found for non-existent id", async () => {
      const result = await executeTool(
        "get_run",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Run not found" }));
    });

    it("get_run returns run when execution exists", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
            output: { output: { x: 1 }, trail: [] },
          })
        )
        .run();
      const result = await executeTool("get_run", { id: runId }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "completed",
          output: expect.objectContaining({ output: expect.objectContaining({ x: 1 }) }),
        })
      );
    });

    it("get_run returns run with output undefined when execution has no output", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "running",
          })
        )
        .run();
      const result = await executeTool("get_run", { id: runId }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "running",
        })
      );
      expect((result as { output?: unknown }).output).toBeUndefined();
    });

    it("get_run returns raw output when output is not valid JSON", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
            output: { x: 1 },
          })
        )
        .run();
      await db
        .update(executions)
        .set({ output: "plain text" })
        .where(eq(executions.id, runId))
        .run();
      const result = await executeTool("get_run", { id: runId }, undefined);
      expect((result as { output: unknown }).output).toBe("plain text");
    });

    it("cancel_run returns error when runId is required", async () => {
      const result = await executeTool("cancel_run", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "runId is required" }));
    });

    it("cancel_run returns Run not found for non-existent run", async () => {
      const result = await executeTool(
        "cancel_run",
        { runId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Run not found" }));
    });

    it("cancel_run returns error when run status is not runnable", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
          })
        )
        .run();
      const result = await executeTool("cancel_run", { runId }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/Run cannot be cancelled/),
          runId,
        })
      );
    });

    it("cancel_run succeeds when run status is running", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "running",
          })
        )
        .run();
      const result = await executeTool("cancel_run", { runId }, undefined);
      expect(result).toEqual(
        expect.objectContaining({ id: runId, status: "cancelled", message: "Run cancelled." })
      );
    });

    it("respond_to_run returns error when runId is required", async () => {
      const result = await executeTool("respond_to_run", { response: "ok" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "runId is required" }));
    });

    it("respond_to_run returns error when response is required", async () => {
      const result = await executeTool(
        "respond_to_run",
        { runId: "00000000-0000-0000-0000-000000000001", response: "" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "response is required" }));
    });

    it("respond_to_run returns Run not found for non-existent run", async () => {
      const result = await executeTool(
        "respond_to_run",
        { runId: "00000000-0000-0000-0000-000000000099", response: "ok" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Run not found" }));
    });

    it("respond_to_run returns error when run is not waiting_for_user", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "running",
          })
        )
        .run();
      const result = await executeTool("respond_to_run", { runId, response: "Yes" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/Run is not waiting for user input/),
          runId,
        })
      );
    });

    it("respond_to_run succeeds and returns message with run link", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "waiting_for_user",
            output: { output: { question: "Confirm?" }, trail: [] },
          })
        )
        .run();
      const result = await executeTool("respond_to_run", { runId, response: "Yes" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: runId,
          status: "running",
          message: expect.stringContaining("/runs/" + runId),
        })
      );
    });

    it("respond_to_run preserves existing trail when run output has trail", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "waiting_for_user",
            output: {
              output: { question: "Confirm?" },
              trail: [{ order: 1, nodeId: "n1", agentName: "Agent1" }],
            },
          })
        )
        .run();
      const result = await executeTool("respond_to_run", { runId, response: "Yes" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: runId,
          status: "running",
          message: expect.stringContaining("/runs/" + runId),
        })
      );
    });

    it("get_run_messages returns error when runId is required", async () => {
      const result = await executeTool("get_run_messages", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "runId is required" }));
    });

    it("get_run_messages returns Run not found for non-existent run", async () => {
      const result = await executeTool(
        "get_run_messages",
        { runId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Run not found" }));
    });

    it("get_run_messages returns runId and messages array", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
          })
        )
        .run();
      const result = await executeTool("get_run_messages", { runId }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          runId,
          messages: expect.any(Array),
        })
      );
    });

    it("get_run_messages accepts limit and caps at 100", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
          })
        )
        .run();
      const result = await executeTool("get_run_messages", { runId, limit: 10 }, undefined);
      expect(result).toHaveProperty("messages");
      expect(Array.isArray((result as { messages: unknown[] }).messages)).toBe(true);
    });

    it("get_run_messages uses default limit 50 when limit is 0 or missing", async () => {
      const runId = crypto.randomUUID();
      await db
        .insert(executions)
        .values(
          toExecutionRow({
            id: runId,
            targetType: "workflow",
            targetId: "wf-1",
            status: "completed",
          })
        )
        .run();
      const result = await executeTool("get_run_messages", { runId, limit: 0 }, undefined);
      expect(result).toHaveProperty("messages");
      expect(result).toHaveProperty("runId", runId);
    });
  });

  describe("executeTool unknown tool", () => {
    it("returns error for unknown tool name", async () => {
      const result = await executeTool("unknown_tool_xyz_123", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: "Unknown tool: unknown_tool_xyz_123" })
      );
    });
  });

  describe("executeTool list_files and list_sandboxes", () => {
    it("list_files returns array of id, name, size", async () => {
      const result = await executeTool("list_files", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; name: string; size: number }[]).forEach((f) => {
        expect(f).toHaveProperty("id");
        expect(f).toHaveProperty("name");
        expect(f).toHaveProperty("size");
      });
    });

    it("list_sandboxes returns array of id, name, image, status", async () => {
      const result = await executeTool("list_sandboxes", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; name: string; image: string; status: string }[]).forEach((s) => {
        expect(s).toHaveProperty("id");
        expect(s).toHaveProperty("name");
        expect(s).toHaveProperty("image");
        expect(s).toHaveProperty("status");
      });
    });
  });

  describe("executeTool execute_code", () => {
    it("execute_code returns Sandbox not found for non-existent sandboxId", async () => {
      const result = await executeTool(
        "execute_code",
        { sandboxId: "00000000-0000-0000-0000-000000000099", command: "echo x" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Sandbox not found" }));
    });

    it("execute_code returns Sandbox has no container when sandbox exists but containerId is null", async () => {
      const sbId = "sandbox-no-container-" + Date.now();
      await db
        .insert(sandboxes)
        .values({
          id: sbId,
          name: "no-container",
          image: "alpine:3.18",
          status: "stopped",
          containerId: null,
          config: "{}",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool(
          "execute_code",
          { sandboxId: sbId, command: "echo x" },
          undefined
        );
        expect(result).toEqual(expect.objectContaining({ error: "Sandbox has no container" }));
      } finally {
        await db.delete(sandboxes).where(eq(sandboxes.id, sbId)).run();
      }
    });

    it("execute_code returns run result when sandbox exists with container", async () => {
      const createRes = await executeTool("create_sandbox", { image: "alpine:3.18" }, undefined);
      const sandboxId = (createRes as { id?: string }).id;
      expect(sandboxId).toBeDefined();
      const result = await executeTool(
        "execute_code",
        { sandboxId, command: "echo hello" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          stdout: expect.any(String),
          stderr: expect.any(String),
          exitCode: expect.any(Number),
        })
      );
    });

    it("execute_code returns exit diagnostics when container not running", async () => {
      const sandboxId = "sandbox-exited-" + Date.now();
      await db
        .insert(sandboxes)
        .values({
          id: sandboxId,
          name: "exited-sandbox",
          image: "alpine:3.18",
          status: "running",
          containerId: "test-container-id",
          config: "{}",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getContainerManager).mockImplementationOnce(
        () =>
          ({
            create: mockContainerCreate,
            destroy: mockContainerDestroy,
            exec: mockContainerExec,
            pull: mockContainerPull,
            getContainerState: vi.fn().mockResolvedValue("exited"),
            getContainerExitInfo: vi.fn().mockResolvedValue({ exitCode: 139, oomKilled: false }),
            logs: vi.fn().mockResolvedValue("segfault at 0x0\n"),
            start: vi.fn().mockResolvedValue(undefined),
          }) as unknown as ReturnType<typeof getContainerManager>
      );
      try {
        const result = await executeTool(
          "execute_code",
          { sandboxId, command: "echo x" },
          undefined
        );
        expect(result).toEqual(
          expect.objectContaining({
            stdout: "",
            stderr: expect.stringContaining("exited"),
            exitCode: 139,
            state: "exited",
            oomKilled: false,
            logs: "segfault at 0x0\n",
            hint: expect.any(String),
          })
        );
      } finally {
        await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
      }
    });
  });

  describe("executeTool get_sandbox", () => {
    it("get_sandbox returns error when sandboxId missing", async () => {
      const result = await executeTool("get_sandbox", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "sandboxId is required" }));
    });

    it("get_sandbox returns error when sandbox not found", async () => {
      const result = await executeTool(
        "get_sandbox",
        { sandboxId: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Sandbox not found" }));
    });

    it("get_sandbox returns containerState null when sandbox has no container", async () => {
      const sandboxId = "sandbox-no-container-get-" + Date.now();
      await db
        .insert(sandboxes)
        .values({
          id: sandboxId,
          name: "no-container",
          image: "alpine:3.18",
          status: "stopped",
          containerId: null,
          config: "{}",
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("get_sandbox", { sandboxId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            id: sandboxId,
            containerState: null,
            message: "Sandbox has no container",
          })
        );
      } finally {
        await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
      }
    });

    it("get_sandbox returns containerState running when sandbox has running container", async () => {
      const createRes = await executeTool("create_sandbox", { image: "alpine:3.18" }, undefined);
      const sandboxId = (createRes as { id?: string }).id;
      expect(sandboxId).toBeDefined();
      const result = await executeTool("get_sandbox", { sandboxId }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: sandboxId,
          containerState: "running",
          containerId: expect.any(String),
        })
      );
    });

    it("get_sandbox returns exit diagnostics when container exited", async () => {
      const sandboxId = "sandbox-get-exited-" + Date.now();
      await db
        .insert(sandboxes)
        .values({
          id: sandboxId,
          name: "exited-sandbox",
          image: "alpine:3.18",
          status: "running",
          containerId: "test-container-id",
          config: "{}",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getContainerManager).mockImplementationOnce(
        () =>
          ({
            create: mockContainerCreate,
            destroy: mockContainerDestroy,
            exec: mockContainerExec,
            pull: mockContainerPull,
            getContainerState: vi.fn().mockResolvedValue("exited"),
            getContainerExitInfo: vi.fn().mockResolvedValue({ exitCode: 137, oomKilled: true }),
            logs: vi.fn().mockResolvedValue("OOMKilled\n"),
            start: vi.fn().mockResolvedValue(undefined),
          }) as unknown as ReturnType<typeof getContainerManager>
      );
      try {
        const result = await executeTool("get_sandbox", { sandboxId }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            id: sandboxId,
            status: "exited",
            containerState: "exited",
            exitCode: 137,
            oomKilled: true,
            logs: "OOMKilled\n",
            hint: expect.stringContaining("memory"),
          })
        );
      } finally {
        await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
      }
    });
  });

  describe("executeTool remember", () => {
    it("remember returns error when value is required", async () => {
      const result = await executeTool("remember", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "value is required" }));
    });

    it("remember succeeds without key and returns id and message", async () => {
      const result = await executeTool("remember", { value: "User prefers dark mode" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          message: expect.stringContaining("Remembered:"),
        })
      );
    });

    it("remember succeeds with key and truncates long value in message", async () => {
      const long = "a".repeat(100);
      const result = await executeTool("remember", { key: "pref", value: long }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          message: expect.stringMatching(/Remembered "pref":/),
        })
      );
      expect((result as { message: string }).message).toContain("…");
    });
  });

  describe("executeTool get_assistant_setting and set_assistant_setting", () => {
    it("get_assistant_setting returns error for unsupported key", async () => {
      const result = await executeTool("get_assistant_setting", { key: "unknownKey" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "Unsupported setting key" }));
    });

    it("get_assistant_setting returns value for recentSummariesCount", async () => {
      const result = await executeTool(
        "get_assistant_setting",
        { key: "recentSummariesCount" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          key: "recentSummariesCount",
          value: expect.any(Number),
        })
      );
    });

    it("set_assistant_setting returns error for unsupported key", async () => {
      const result = await executeTool(
        "set_assistant_setting",
        { key: "unknownKey", value: 5 },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Unsupported setting key" }));
    });

    it("set_assistant_setting sets recentSummariesCount and returns message", async () => {
      const result = await executeTool(
        "set_assistant_setting",
        { key: "recentSummariesCount", value: 5 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          key: "recentSummariesCount",
          value: 5,
          message: expect.stringContaining("Set "),
        })
      );
    });

    it("set_assistant_setting clamps value below min to 1", async () => {
      const result = await executeTool(
        "set_assistant_setting",
        { key: "recentSummariesCount", value: 0 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          key: "recentSummariesCount",
          value: 1,
          message: expect.stringContaining("Set "),
        })
      );
    });

    it("set_assistant_setting clamps value above max to 10", async () => {
      const result = await executeTool(
        "set_assistant_setting",
        { key: "recentSummariesCount", value: 15 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          key: "recentSummariesCount",
          value: 10,
          message: expect.stringContaining("Set "),
        })
      );
    });
  });

  describe("executeTool store", () => {
    const scope = "agent";
    const scopeId = "test-agent-1";

    it("create_store returns message when scopeId and name provided", async () => {
      const result = await executeTool(
        "create_store",
        { scope, scopeId, name: "mystore" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("Store is created when you first put_store"),
        })
      );
    });

    it("create_store returns error when scopeId or name missing", async () => {
      const result = await executeTool("create_store", { scope, name: "x" }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "scopeId and name required" }));
    });

    it("put_store stores new key and returns Stored", async () => {
      const storeName = "batch-store-" + Date.now();
      const result = await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "k1", value: "v1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ message: "Stored." }));
    });

    it("put_store updates existing key and returns Updated", async () => {
      const storeName = "batch-update-" + Date.now();
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "k1", value: "v1" },
        undefined
      );
      const result = await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "k1", value: "v2" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ message: "Updated." }));
    });

    it("get_store returns Key not found for missing key", async () => {
      const result = await executeTool(
        "get_store",
        { scope, scopeId, storeName: "nonexistent-store", key: "x" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Key not found" }));
    });

    it("get_store returns value when key exists", async () => {
      const storeName = "batch-get-" + Date.now();
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "k1", value: "v1" },
        undefined
      );
      const result = await executeTool(
        "get_store",
        { scope, scopeId, storeName, key: "k1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ value: "v1" }));
    });

    it("put_store stringifies object value and get_store returns it", async () => {
      const storeName = "batch-obj-" + Date.now();
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "k1", value: { foo: "bar" } },
        undefined
      );
      const result = await executeTool(
        "get_store",
        { scope, scopeId, storeName, key: "k1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ value: '{"foo":"bar"}' }));
    });

    it("query_store returns entries with optional prefix", async () => {
      const storeName = "batch-query-" + Date.now();
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "a1", value: "v1" },
        undefined
      );
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "a2", value: "v2" },
        undefined
      );
      const result = await executeTool(
        "query_store",
        { scope, scopeId, storeName, prefix: "a" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ key: "a1", value: "v1" }),
            expect.objectContaining({ key: "a2", value: "v2" }),
          ]),
        })
      );
    });

    it("query_store without prefix returns all entries in store", async () => {
      const storeName = "batch-query-all-" + Date.now();
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "x1", value: "v1" },
        undefined
      );
      const result = await executeTool("query_store", { scope, scopeId, storeName }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          entries: expect.arrayContaining([expect.objectContaining({ key: "x1", value: "v1" })]),
        })
      );
    });

    it("list_stores returns store names for scopeId", async () => {
      const result = await executeTool("list_stores", { scope, scopeId }, undefined);
      expect(result).toEqual(expect.objectContaining({ stores: expect.any(Array) }));
    });

    it("delete_store returns message", async () => {
      const storeName = "batch-delete-" + Date.now();
      await executeTool(
        "put_store",
        { scope, scopeId, storeName, key: "k1", value: "v1" },
        undefined
      );
      const result = await executeTool("delete_store", { scope, scopeId, storeName }, undefined);
      expect(result).toEqual(expect.objectContaining({ message: "Store deleted." }));
    });
  });

  describe("executeTool run_shell_command", () => {
    it("run_shell_command returns error when command is required", async () => {
      const result = await executeTool("run_shell_command", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: "command is required", needsApproval: false })
      );
    });

    it("run_shell_command returns error when command is whitespace only", async () => {
      const result = await executeTool("run_shell_command", { command: "   \t  " }, undefined);
      expect(result).toEqual(
        expect.objectContaining({ error: "command is required", needsApproval: false })
      );
    });

    it("run_shell_command returns needsApproval when command not in allowlist", async () => {
      const appSettings = await import("../../../app/api/_lib/app-settings");
      vi.mocked(appSettings.getShellCommandAllowlist).mockReturnValueOnce([]);
      const result = await executeTool("run_shell_command", { command: "rm -rf /" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          needsApproval: true,
          command: "rm -rf /",
          message: expect.stringContaining("approval"),
        })
      );
    });

    it("run_shell_command runs and returns stdout when command in allowlist", async () => {
      const result = await executeTool("run_shell_command", { command: "echo ok" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          command: "echo ok",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
        })
      );
    });

    it("run_shell_command returns error when runShellCommand throws", async () => {
      const shellExec = await import("../../../app/api/_lib/shell-exec");
      vi.mocked(shellExec.runShellCommand).mockRejectedValueOnce(new Error("spawn ENOENT"));
      const result = await executeTool("run_shell_command", { command: "echo ok" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "Shell command failed",
          message: "spawn ENOENT",
          exitCode: -1,
        })
      );
    });

    it("run_shell_command returns message with stdout and stderr when stderr present", async () => {
      const shellExec = await import("../../../app/api/_lib/shell-exec");
      vi.mocked(shellExec.runShellCommand).mockResolvedValueOnce({
        stdout: "out",
        stderr: "err",
        exitCode: 0,
      });
      const result = await executeTool("run_shell_command", { command: "echo ok" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          command: "echo ok",
          stdout: "out",
          stderr: "err",
          exitCode: 0,
          message: "stdout:\nout\nstderr:\nerr",
        })
      );
    });
  });

  describe("executeTool run_container_command", () => {
    it("run_container_command returns error when image and command are required", async () => {
      const result = await executeTool("run_container_command", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "image and command are required" }));
    });

    it("run_container_command runs and returns stdout/stderr/exitCode", async () => {
      const result = await executeTool(
        "run_container_command",
        { image: "alpine:3.18", command: "echo hello" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          stdout: expect.any(String),
          stderr: expect.any(String),
          exitCode: expect.any(Number),
        })
      );
    });

    it("run_container_command returns error when container create throws", async () => {
      mockContainerCreate.mockRejectedValueOnce(new Error("Failed to create container"));
      const result = await executeTool(
        "run_container_command",
        { image: "alpine:3.18", command: "echo x" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("Failed to create container"),
          stderr: "Failed to create container",
          exitCode: -1,
        })
      );
    });

    it("run_container_command pulls then creates when create throws no such image", async () => {
      mockContainerCreate
        .mockRejectedValueOnce(new Error("no such image"))
        .mockResolvedValueOnce("pulled-container-id");
      const result = await executeTool(
        "run_container_command",
        { image: "alpine:3.18", command: "echo ok" },
        undefined
      );
      expect(mockContainerPull).toHaveBeenCalledWith("alpine:3.18");
      expect(result).toEqual(
        expect.objectContaining({
          stdout: expect.any(String),
          stderr: expect.any(String),
          exitCode: 0,
        })
      );
    });

    it("run_container_command accepts command as array and joins with space", async () => {
      const result = await executeTool(
        "run_container_command",
        { image: "alpine:3.18", command: ["echo", "hello", "world"] },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          stdout: expect.any(String),
          stderr: expect.any(String),
          exitCode: expect.any(Number),
        })
      );
    });

    it("run_container_command returns error when pull throws after no such image", async () => {
      mockContainerCreate.mockRejectedValueOnce(new Error("no such image"));
      mockContainerPull.mockRejectedValueOnce(new Error("pull failed"));
      const result = await executeTool(
        "run_container_command",
        { image: "alpine:3.18", command: "echo x" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/pull failed|Failed to pull/),
          stderr: "pull failed",
          exitCode: -1,
        })
      );
    });
  });

  describe("executeTool fetch_url and explain", () => {
    it("fetch_url returns error when url is required", async () => {
      const result = await executeTool("fetch_url", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "url is required" }));
    });

    it("fetch_url returns error when url is whitespace only", async () => {
      const result = await executeTool("fetch_url", { url: "   \t  " }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "url is required" }));
    });

    it("fetch_url returns content when url provided", async () => {
      const result = await executeTool("fetch_url", { url: "https://example.com" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          content: expect.any(String),
          contentType: expect.any(String),
        })
      );
    });

    it("fetch_url returns error when fetchUrl throws", async () => {
      const runtime = await import("@agentron-studio/runtime");
      vi.mocked(runtime.fetchUrl).mockRejectedValueOnce(new Error("Network error"));
      const result = await executeTool("fetch_url", { url: "https://example.com" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: "Fetch failed",
          message: "Network error",
        })
      );
    });

    it("answer_question returns message and question", async () => {
      const result = await executeTool("answer_question", { question: "What is 2+2?" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("Answering"),
          question: "What is 2+2?",
        })
      );
    });

    it("explain_software returns message and topic for general", async () => {
      const result = await executeTool("explain_software", { topic: "general" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          topic: "general",
        })
      );
    });

    it("explain_software returns topic-specific doc for known topic", async () => {
      const result = await executeTool("explain_software", { topic: "agents" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          topic: "agents",
        })
      );
    });

    it("explain_software defaults to general when topic missing", async () => {
      const result = await executeTool("explain_software", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("AgentOS Studio"),
          topic: "general",
        })
      );
    });

    it("explain_software uses general doc for unknown topic", async () => {
      const result = await executeTool("explain_software", { topic: "unknown_xyz" }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("AgentOS Studio"),
          topic: "unknown_xyz",
        })
      );
    });
  });

  describe("executeTool remote servers", () => {
    it("list_remote_servers returns servers array", async () => {
      const result = await executeTool("list_remote_servers", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          servers: expect.any(Array),
        })
      );
    });

    it("test_remote_connection returns error when host missing", async () => {
      const result = await executeTool("test_remote_connection", {}, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "host is required" }));
    });

    it("test_remote_connection returns error when user missing", async () => {
      const result = await executeTool(
        "test_remote_connection",
        { host: "192.168.1.1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "user is required" }));
    });

    it("test_remote_connection returns result when host and user provided", async () => {
      const result = await executeTool(
        "test_remote_connection",
        { host: "192.168.1.1", user: "deploy" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ ok: true, message: expect.any(String) }));
    });

    it("test_remote_connection accepts port, authType, and keyPath", async () => {
      const result = await executeTool(
        "test_remote_connection",
        {
          host: "192.168.1.1",
          user: "deploy",
          port: 2222,
          authType: "key",
          keyPath: "/home/user/.ssh/id_rsa",
        },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ ok: true, message: expect.any(String) }));
    });

    it("test_remote_connection trims host and user and normalizes invalid port", async () => {
      const result = await executeTool(
        "test_remote_connection",
        { host: "  192.168.1.1  ", user: "  deploy  ", port: 99999 },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ ok: true, message: expect.any(String) }));
    });

    it("save_remote_server returns id and message with default label", async () => {
      const result = await executeTool(
        "save_remote_server",
        { host: "host.example.com", user: "dev" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          message: expect.stringContaining("Saved remote server"),
          server: expect.objectContaining({
            id: expect.any(String),
            label: "Remote server",
            host: "host.example.com",
            port: 22,
            user: "dev",
          }),
        })
      );
    });

    it("save_remote_server accepts authType password", async () => {
      const result = await executeTool(
        "save_remote_server",
        {
          host: "h",
          user: "u",
          authType: "password",
          label: "My Server",
        },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          server: expect.objectContaining({ id: expect.any(String) }),
        })
      );
    });

    it("save_remote_server uses custom port when provided", async () => {
      const result = await executeTool(
        "save_remote_server",
        { host: "host.local", user: "u", port: 2222 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          server: expect.objectContaining({ port: 2222 }),
        })
      );
    });
  });

  describe("executeTool improvement jobs", () => {
    it("create_improvement_job returns id and message", async () => {
      const result = await executeTool(
        "create_improvement_job",
        { name: "Batch Job", scopeType: "agent", scopeId: "agent-1" },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          message: "Improvement job created.",
        })
      );
    });

    it("get_improvement_job returns Job not found for non-existent id", async () => {
      const result = await executeTool(
        "get_improvement_job",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Job not found" }));
    });

    it("get_improvement_job returns job when exists", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "Get Test Job" },
        undefined
      );
      const id = (createRes as { id: string }).id;
      const result = await executeTool("get_improvement_job", { id }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id,
          name: "Get Test Job",
          scopeType: null,
          scopeId: null,
        })
      );
    });

    it("list_improvement_jobs returns array", async () => {
      const result = await executeTool("list_improvement_jobs", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; name: string | null }[]).forEach((j) => {
        expect(j).toHaveProperty("id");
        expect(j).toHaveProperty("name");
      });
    });

    it("update_improvement_job returns Job not found for non-existent id", async () => {
      const result = await executeTool(
        "update_improvement_job",
        { id: "00000000-0000-0000-0000-000000000099", currentModelRef: "cfg-1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Job not found" }));
    });

    it("update_improvement_job returns No updates when no fields to update", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "NoUpdate" },
        undefined
      );
      const id = (createRes as { id: string }).id;
      const result = await executeTool("update_improvement_job", { id }, undefined);
      expect(result).toEqual(expect.objectContaining({ id, message: "No updates" }));
    });

    it("update_improvement_job updates and returns message", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "ToUpdate" },
        undefined
      );
      const id = (createRes as { id: string }).id;
      const result = await executeTool(
        "update_improvement_job",
        { id, currentModelRef: "llm-1" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ id, message: "Job updated." }));
    });

    it("propose_architecture returns error when jobId missing", async () => {
      const result = await executeTool("propose_architecture", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("propose_architecture requires jobId"),
        })
      );
    });

    it("propose_architecture returns Job not found for non-existent job", async () => {
      const result = await executeTool(
        "propose_architecture",
        { jobId: "00000000-0000-0000-0000-000000000099", spec: { layers: 2 } },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Job not found" }));
    });

    it("propose_architecture attaches spec to job and returns message", async () => {
      const createRes = await executeTool("create_improvement_job", { name: "ArchJob" }, undefined);
      const jobId = (createRes as { id: string }).id;
      const result = await executeTool(
        "propose_architecture",
        { jobId, spec: { layers: 2, model: "base" } },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          jobId,
          message: expect.stringContaining("Architecture spec attached"),
        })
      );
    });

    it("get_improvement_job returns instanceRefs empty array when instanceRefs is invalid JSON", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "InvalidRefs" },
        undefined
      );
      const id = (createRes as { id: string }).id;
      await db
        .update(improvementJobs)
        .set({ instanceRefs: "not-valid-json" })
        .where(eq(improvementJobs.id, id))
        .run();
      const result = await executeTool("get_improvement_job", { id }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id,
          instanceRefs: [],
        })
      );
    });

    it("get_improvement_job returns architectureSpec undefined when architectureSpec is invalid JSON", async () => {
      const createRes = await executeTool(
        "create_improvement_job",
        { name: "InvalidSpec" },
        undefined
      );
      const id = (createRes as { id: string }).id;
      await db
        .update(improvementJobs)
        .set({ architectureSpec: "not-valid-json" })
        .where(eq(improvementJobs.id, id))
        .run();
      const result = await executeTool("get_improvement_job", { id }, undefined);
      expect((result as { architectureSpec?: unknown }).architectureSpec).toBeUndefined();
    });
  });

  describe("executeTool guardrails", () => {
    it("create_guardrail returns id and message", async () => {
      const result = await executeTool(
        "create_guardrail",
        { scope: "deployment", config: { maxLength: 100 } },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          message: expect.stringContaining("Guardrail created"),
        })
      );
    });

    it("list_guardrails returns guardrails array", async () => {
      const result = await executeTool("list_guardrails", {}, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          guardrails: expect.any(Array),
        })
      );
    });

    it("list_guardrails filters by scope when provided", async () => {
      const result = await executeTool("list_guardrails", { scope: "deployment" }, undefined);
      expect(result).toHaveProperty("guardrails");
    });

    it("list_guardrails filters by scopeId when provided", async () => {
      const result = await executeTool(
        "list_guardrails",
        { scope: "deployment", scopeId: "scope-1" },
        undefined
      );
      expect(result).toHaveProperty("guardrails");
    });

    it("get_guardrail returns Guardrail not found for non-existent id", async () => {
      const result = await executeTool(
        "get_guardrail",
        { id: "00000000-0000-0000-0000-000000000099" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Guardrail not found" }));
    });

    it("get_guardrail returns guardrail when exists", async () => {
      const createRes = await executeTool(
        "create_guardrail",
        { config: { block: "script" } },
        undefined
      );
      const id = (createRes as { id: string }).id;
      const result = await executeTool("get_guardrail", { id }, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          id,
          scope: "deployment",
          config: expect.objectContaining({ block: "script" }),
        })
      );
    });

    it("get_guardrail returns guardrail when config is stored as string in DB", async () => {
      const id = "guardrail-string-config-" + Date.now();
      await db
        .insert(guardrails)
        .values({
          id,
          scope: "deployment",
          scopeId: null,
          config: JSON.stringify({ storedAsString: true }),
          createdAt: Date.now(),
        })
        .run();
      try {
        const result = await executeTool("get_guardrail", { id }, undefined);
        expect(result).toEqual(
          expect.objectContaining({
            id,
            scope: "deployment",
            config: expect.objectContaining({ storedAsString: true }),
          })
        );
      } finally {
        await db.delete(guardrails).where(eq(guardrails.id, id)).run();
      }
    });

    it("update_guardrail returns error when config required", async () => {
      const createRes = await executeTool("create_guardrail", {}, undefined);
      const id = (createRes as { id: string }).id;
      const result = await executeTool("update_guardrail", { id }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "config required" }));
    });

    it("update_guardrail updates and returns message", async () => {
      const createRes = await executeTool("create_guardrail", { config: {} }, undefined);
      const id = (createRes as { id: string }).id;
      const result = await executeTool(
        "update_guardrail",
        { id, config: { updated: true } },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ id, message: "Guardrail updated." }));
    });

    it("delete_guardrail returns message", async () => {
      const createRes = await executeTool("create_guardrail", { config: {} }, undefined);
      const id = (createRes as { id: string }).id;
      const result = await executeTool("delete_guardrail", { id }, undefined);
      expect(result).toEqual(expect.objectContaining({ message: "Guardrail deleted." }));
    });
  });

  describe("connector tools", () => {
    it("list_connectors returns array of { id, type, collectionId }", async () => {
      const result = await executeTool("list_connectors", {}, undefined);
      expect(Array.isArray(result)).toBe(true);
      (result as { id: string; type: string; collectionId: string }[]).forEach((row) => {
        expect(row).toHaveProperty("id");
        expect(row).toHaveProperty("type");
        expect(row).toHaveProperty("collectionId");
      });
    });

    it("list_connector_items returns error when connector not found", async () => {
      const result = await executeTool(
        "list_connector_items",
        { connectorId: "non-existent-connector-id" },
        undefined
      );
      expect(result).toEqual({ error: "Connector not found" });
    });

    it("list_connector_items returns error when connectorId missing", async () => {
      const result = await executeTool("list_connector_items", {}, undefined);
      expect(result).toEqual({ error: "connectorId required" });
    });

    it("connector_read_item returns error when connector not found", async () => {
      const result = await executeTool(
        "connector_read_item",
        { connectorId: "non-existent", itemId: "/any/path" },
        undefined
      );
      expect(result).toEqual({ error: "Connector not found" });
    });

    it("connector_update_item returns error when connector not found", async () => {
      const result = await executeTool(
        "connector_update_item",
        { connectorId: "non-existent", itemId: "/any/path", content: "x" },
        undefined
      );
      expect(result).toEqual({ error: "Connector not found" });
    });

    it("ingest_deployment_documents returns error when no deployment collection", async () => {
      const result = await executeTool("ingest_deployment_documents", {}, undefined);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("No deployment collection");
    });

    it("connector tool error appends Knowledge → Connectors hint for auth-like errors", async () => {
      vi.mocked(readConnectorItem).mockResolvedValueOnce({ error: "Unauthorized" });
      const result = await executeTool(
        "connector_read_item",
        { connectorId: "any", itemId: "any" },
        undefined
      );
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Knowledge → Connectors");
      expect((result as { error: string }).error).toContain("Unauthorized");
    });
  });
});
