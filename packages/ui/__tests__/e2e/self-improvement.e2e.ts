/**
 * E2E: Self-improvement — create a run, then get_run_for_improvement(runId); assert run context returned.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e self-improvement", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("self-improvement");
    e2eLog.scenario("self-improvement", "Create run then get_run_for_improvement");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("creates a minimal run then get_run_for_improvement returns run context", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Echo Agent",
        description: "Echoes ok",
        systemPrompt: "Reply with exactly: ok",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Echo WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;
    e2eLog.step("create_workflow", { workflowId });

    const updateRes = await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [{ id: "n1", type: "agent", position: [0, 0], parameters: { agentId } }],
        edges: [],
      },
      undefined
    );
    expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));

    const execRes = await executeTool("execute_workflow", { workflowId }, undefined);
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    const runId = (execRes as { id?: string }).id;
    expect(typeof runId).toBe("string");
    if (typeof runId !== "string") throw new Error("expected runId");
    e2eLog.runId(runId);

    const improveRes = await executeTool("get_run_for_improvement", { runId }, undefined);
    expect(improveRes).not.toEqual(expect.objectContaining({ error: "Run not found" }));
    expect(improveRes).not.toEqual(expect.objectContaining({ error: "runId is required" }));
    const improved = improveRes as {
      id?: string;
      status?: string;
      trailSummary?: string[];
      recentErrors?: unknown[];
    };
    expect(improved.id).toBe(runId);
    expect(typeof improved.status).toBe("string");
    expect(improved.trailSummary !== undefined || improved.recentErrors !== undefined).toBe(true);
    e2eLog.toolCall("get_run_for_improvement", JSON.stringify(improveRes).slice(0, 200));
  }, 60_000);
});
