import { describe, it, expect } from "vitest";
import { resolveTemplateVars, executeTool } from "../../../app/api/chat/_lib/execute-tool";

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
      expect(result).not.toEqual(expect.objectContaining({ error: "targetId or agentId is required" }));
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

    it("update_workflow accepts workflowId when id missing (returns Workflow not found for fake id)", async () => {
      const result = await executeTool(
        "update_workflow",
        { workflowId: "fake-wf-id", name: "X" },
        undefined
      );
      expect(result).toEqual(expect.objectContaining({ error: "Workflow not found" }));
    });
  });
});
