/**
 * E2E: Feedback → learning data — create minimal run, POST feedback, get_feedback_for_scope returns it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { POST as feedbackPost } from "../../app/api/feedback/route";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e feedback-learning", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("feedback-learning");
    e2eLog.scenario("feedback-learning", "Run → POST feedback → get_feedback_for_scope");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("creates minimal run, submits feedback via API, get_feedback_for_scope returns entries", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Feedback Echo Agent",
        description: "Echoes ok for feedback e2e",
        systemPrompt: "Reply with exactly: ok",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Feedback Echo WF" }, undefined);
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
    e2eLog.runId(runId!);

    const postRes = await feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "agent",
          targetId: agentId,
          executionId: runId,
          input: "e2e input",
          output: "ok",
          label: "good",
        }),
      })
    );
    expect(postRes.status).toBe(201);
    e2eLog.step("POST /api/feedback", {});

    const scopeRes = await executeTool(
      "get_feedback_for_scope",
      { targetId: agentId!, label: "good" },
      undefined
    );
    expect(scopeRes).not.toEqual(
      expect.objectContaining({ error: "targetId or agentId is required" })
    );
    expect(Array.isArray(scopeRes)).toBe(true);
    const list = scopeRes as { targetId?: string; label?: string }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    const entry = list.find((f) => f.targetId === agentId && f.label === "good");
    expect(entry).toBeDefined();
    e2eLog.toolCall("get_feedback_for_scope", JSON.stringify(scopeRes).slice(0, 200));
  }, 60_000);
});
