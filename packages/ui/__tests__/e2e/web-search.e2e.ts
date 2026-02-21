/**
 * E2E: Web search — workflow with one agent that has std-web-search; run and assert completion and results shape.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e web-search", () => {
  let workflowId: string;
  let runId: string;
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("web-search");
    e2eLog.scenario("web-search", "Search the web for current year, reply in one sentence");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("creates agent with std-web-search and runs workflow", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Web Search Agent",
        description: "Searches the web and replies briefly",
        systemPrompt:
          "Your task: search the web for 'current year' and reply in one short sentence with what you found. Use the web search tool. Do not make up answers.",
        toolIds: ["std-web-search"],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    if (typeof agentId !== "string") throw new Error("expected agentId");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Web Search WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const rawWorkflowId = (wfRes as { id?: string }).id;
    expect(typeof rawWorkflowId).toBe("string");
    if (typeof rawWorkflowId !== "string") throw new Error("expected workflowId");
    workflowId = rawWorkflowId;
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
    e2eLog.step("update_workflow");

    const execRes = await executeTool("execute_workflow", { workflowId }, undefined);
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow id is required" }));
    const rawRunId = (execRes as { id?: string }).id;
    expect(typeof rawRunId).toBe("string");
    if (typeof rawRunId !== "string") throw new Error("expected runId");
    runId = rawRunId;
    e2eLog.runId(runId);
    e2eLog.toolCall("std-web-search", JSON.stringify(execRes).slice(0, 200));

    const status = (execRes as { status?: string }).status;
    expect(["completed", "failed"]).toContain(status);
    if (status === "completed") {
      const output = (execRes as { output?: unknown }).output;
      const trail = Array.isArray(
        output && typeof output === "object" && (output as { trail?: unknown }).trail
      )
        ? (output as { trail: unknown[] }).trail
        : [];
      const hasWebSearchResult = trail.some(
        (s: unknown) =>
          typeof s === "object" &&
          s !== null &&
          Array.isArray((s as { toolCalls?: unknown[] }).toolCalls) &&
          (s as { toolCalls: { name?: string }[] }).toolCalls.some(
            (t) => t.name === "std-web-search"
          )
      );
      expect(hasWebSearchResult).toBe(true);
    }
  }, 90_000);
});
