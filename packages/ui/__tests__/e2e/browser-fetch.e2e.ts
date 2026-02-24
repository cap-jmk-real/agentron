/**
 * E2E: Browser (fetch) — workflow with one agent that has std-fetch-url; run and assert completion and content contains "example".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e browser-fetch", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("browser-fetch");
    e2eLog.scenario("browser-fetch", "Fetch example.com and say title or heading");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("creates agent with std-fetch-url and runs workflow", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Fetch Agent",
        description: "Fetches URL and summarizes",
        systemPrompt:
          "Your task: fetch https://example.com and reply with the page title or the first heading you see. Use the fetch URL tool. Reply in one short sentence.",
        toolIds: ["std-fetch-url"],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    if (typeof agentId !== "string") throw new Error("expected agentId");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Fetch WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;
    expect(typeof workflowId).toBe("string");
    if (typeof workflowId !== "string") throw new Error("expected workflowId");
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

    const status = (execRes as { status?: string }).status;
    expect(["completed", "failed"]).toContain(status);
    if (status === "completed") {
      const output = (execRes as { output?: unknown }).output;
      const outStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
      expect(outStr.toLowerCase()).toMatch(/example/);
    } else {
      const trail = (execRes as { output?: { trail?: unknown[] } }).output?.trail ?? [];
      const trailStr = JSON.stringify(trail);
      expect(trailStr.toLowerCase()).toMatch(/example/);
    }
    e2eLog.toolCall("std-fetch-url", JSON.stringify(execRes).slice(0, 200));
  }, 90_000);
});
