/**
 * E2E: Workflow CRUD with branches — create_workflow, update_workflow with branches, get_workflow asserts structure (no LLM run).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e workflow-branches-crud", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("workflow-branches-crud");
    e2eLog.scenario(
      "workflow-branches-crud",
      "create_workflow → update_workflow branches → get_workflow"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("create_workflow, update_workflow with branches, get_workflow returns branches", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Branches Agent",
        description: "For branches CRUD e2e",
        systemPrompt: "Reply ok",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Branches WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;
    expect(typeof workflowId).toBe("string");
    e2eLog.step("create_workflow", { workflowId });

    const branches = [
      {
        id: "branch-main",
        nodes: [
          {
            id: "n1",
            type: "agent",
            position: [0, 0] as [number, number],
            parameters: { agentId },
          },
        ],
        edges: [] as { id: string; source: string; target: string }[],
        maxRounds: 2,
        executionMode: "once" as const,
      },
    ];

    const updateRes = await executeTool("update_workflow", { id: workflowId, branches }, undefined);
    expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    e2eLog.step("update_workflow branches", {});

    const getRes = await executeTool("get_workflow", { id: workflowId }, undefined);
    expect(getRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    const w = getRes as { id?: string; branches?: typeof branches };
    expect(Array.isArray(w.branches)).toBe(true);
    expect(w.branches!.length).toBe(1);
    expect(w.branches![0].id).toBe("branch-main");
    expect(w.branches![0].maxRounds).toBe(2);
    expect(w.branches![0].executionMode).toBe("once");
    expect(Array.isArray(w.branches![0].nodes)).toBe(true);
    expect(w.branches![0].nodes!.length).toBe(1);
    e2eLog.toolCall("get_workflow", JSON.stringify(getRes).slice(0, 200));
  }, 30_000);
});
