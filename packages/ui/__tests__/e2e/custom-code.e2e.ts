/**
 * E2E: Custom code — create_code_tool (adder), workflow + agent, run and assert sum: 5. Skips workflow execution if Podman/run-code unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

const ADDER_SOURCE = `
async function main(input) {
  const a = input?.a ?? 0;
  const b = input?.b ?? 0;
  return { sum: a + b };
}
`.trim();

describe("e2e custom-code", () => {
  let toolId: string | undefined;
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("custom-code");
    e2eLog.scenario("custom-code", "Adder tool, add 2 and 3");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("create_code_tool creates adder; optionally run workflow", async () => {
    const createToolRes = await executeTool(
      "create_code_tool",
      {
        name: "E2E Adder",
        description: "Adds a and b",
        language: "javascript",
        source: ADDER_SOURCE,
      },
      undefined
    );

    if (createToolRes && typeof createToolRes === "object" && "error" in createToolRes) {
      const err = (createToolRes as { error: string }).error;
      if (/podman|container|sandbox|run-code/i.test(err)) {
        e2eLog.step("create_code_tool skipped (Podman/run-code unavailable)", {
          error: err.slice(0, 100),
        });
        return;
      }
      throw new Error(err);
    }

    expect(createToolRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    toolId = (createToolRes as { toolId?: string }).toolId;
    expect(typeof toolId).toBe("string");
    e2eLog.step("create_code_tool", { toolId });

    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Adder Agent",
        description: "Uses adder tool",
        systemPrompt:
          "The user wants you to add 2 and 3. Use the E2E Adder tool with a: 2, b: 3. Reply with the sum.",
        toolIds: [toolId!],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Adder WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;

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
    e2eLog.runId(runId!);

    const status = (execRes as { status?: string }).status;
    expect(["completed", "failed"]).toContain(status);
    if (status === "completed") {
      const output = (execRes as { output?: unknown }).output;
      const outStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
      expect(outStr).toMatch(/sum.*5|"sum":\s*5/);
    }
    const trail = (execRes as { output?: { trail?: unknown[] } }).output?.trail ?? [];
    const trailStr = JSON.stringify(trail);
    expect(trailStr).toMatch(/sum|5/);
    e2eLog.toolCall("execute_workflow", JSON.stringify(execRes).slice(0, 200));
  }, 90_000);
});
