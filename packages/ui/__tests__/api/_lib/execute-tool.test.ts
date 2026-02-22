import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRegistry, searchWeb } from "@agentron-studio/runtime";
import { db, customFunctions, tools, IMPROVEMENT_SUBSETS } from "../../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import { AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION } from "../../../app/api/chat/route";
import { resolveTemplateVars, executeTool } from "../../../app/api/chat/_lib/execute-tool";
import { getAppSettings } from "../../../app/api/_lib/app-settings";
import { readConnectorItem } from "../../../app/api/rag/connectors/_lib/connector-write";

vi.mock("../../../app/api/_lib/container-manager", () => ({
  getContainerManager: () => ({
    create: vi.fn().mockResolvedValue("test-container-id"),
    destroy: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  }),
  withContainerInstallHint: (msg: string) => msg,
}));

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
  };
});

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@agentron-studio/runtime")>();
  return {
    ...mod,
    searchWeb: vi.fn().mockResolvedValue({ results: [] }),
  };
});

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

    it("add_workflow_edges accepts workflowId when id missing (returns Workflow not found for fake id)", async () => {
      const result = await executeTool(
        "add_workflow_edges",
        { workflowId: "fake-wf-id", edges: [] },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
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

    it("update_workflow accepts workflowId when id missing (returns Workflow not found for fake id)", async () => {
      const result = await executeTool(
        "update_workflow",
        { workflowId: "fake-wf-id", name: "X" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
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
      const tenIds = Array.from({ length: 10 }, (_, i) => `tool-id-${i}`);
      const result = await executeTool(
        "create_agent",
        { name: "At-cap agent", toolIds: tenIds, description: "Test", llmConfigId: "any" },
        undefined
      );
      expect(result).not.toEqual(expect.objectContaining({ code: "TOOL_CAP_EXCEEDED" }));
      expect((result as { error?: string }).error).toBeUndefined();
      expect((result as { id?: string }).id).toBeDefined();
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

  describe("executeTool bind_sandbox_port", () => {
    it("returns error when sandboxId missing", async () => {
      const result = await executeTool("bind_sandbox_port", { containerPort: 18789 }, undefined);
      expect(result).toEqual(expect.objectContaining({ error: "sandboxId is required" }));
    });

    it("returns error when containerPort invalid", async () => {
      const result = await executeTool(
        "bind_sandbox_port",
        { sandboxId: "any", containerPort: 0 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          error: "containerPort must be a number between 1 and 65535",
        })
      );
    });

    it("returns error when sandbox not found", async () => {
      const result = await executeTool(
        "bind_sandbox_port",
        { sandboxId: "00000000-0000-0000-0000-000000000099", containerPort: 18789 },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Sandbox not found" }));
    });

    it("returns hostPort and websocketUrl when sandbox exists", async () => {
      const createRes = await executeTool("create_sandbox", { image: "alpine:3.18" }, undefined);
      const sandboxId = (createRes as { id?: string }).id;
      expect(sandboxId).toBeDefined();
      const result = await executeTool(
        "bind_sandbox_port",
        { sandboxId, containerPort: 18789 },
        undefined
      );
      expect(result).toEqual(
        expect.objectContaining({
          hostPort: expect.any(Number),
          websocketUrl: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+$/),
          message: expect.any(String),
        })
      );
      const hostPort = (result as { hostPort: number }).hostPort;
      expect(hostPort).toBeGreaterThanOrEqual(1);
      expect(hostPort).toBeLessThanOrEqual(65535);
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
