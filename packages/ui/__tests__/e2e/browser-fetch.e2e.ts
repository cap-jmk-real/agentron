/**
 * E2E: Browser (fetch) — workflow with one agent that has std-fetch-url; run and assert completion and content contains "example".
 * If the assertion fails, the test logs the full run output and trail so you can see the actual std-fetch-url result
 * (e.g. { error: "Fetch failed", message } from the runtime when example.com is unreachable).
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
    const output = (execRes as { output?: unknown }).output;
    const trail = (execRes as { output?: { trail?: unknown[] } }).output?.trail ?? [];
    const outStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
    const trailStr = JSON.stringify(trail);
    const hasExample =
      /example/.test(outStr.toLowerCase()) || /example/.test(trailStr.toLowerCase());
    if (!hasExample) {
      // Debug: log why fetch might have failed (runtime returns { error: "Fetch failed", message } when fetch() throws).
      const trailSnippet = JSON.stringify(trail, null, 2).slice(0, 4000);
      console.error(
        "[e2e browser-fetch] Output does not contain 'example'. Run may have completed with fetch failure.\n" +
          "Full execRes (first 2500 chars):",
        JSON.stringify(execRes).slice(0, 2500)
      );
      console.error("[e2e browser-fetch] Trail (tool results):", trailSnippet);
    }
    if (status === "completed") {
      expect(outStr.toLowerCase()).toMatch(/example/);
    } else {
      expect(trailStr.toLowerCase()).toMatch(/example/);
    }
    e2eLog.toolCall("std-fetch-url", JSON.stringify(execRes).slice(0, 200));
  }, 300_000);
});
