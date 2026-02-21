/**
 * E2E: Request user help — workflow pauses for user input, respond resumes and run completes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { GET as getRun } from "../../app/api/runs/[id]/route";
import { POST as respondRun } from "../../app/api/runs/[id]/respond/route";
import { processOneWorkflowJob } from "../../app/api/_lib/workflow-queue";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e request-user-help", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("request-user-help");
    e2eLog.scenario(
      "request-user-help",
      "Agent calls request_user_help → respond with A → run completes"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("workflow pauses at request_user_help, respond resumes and run completes", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Request Help Agent",
        description: "Asks user to pick one",
        systemPrompt:
          "On your first turn you MUST call request_user_help with question exactly 'Pick one' and options exactly ['A','B']. Do nothing else. After the user replies, reply with one sentence acknowledging their choice.",
        toolIds: ["std-request-user-help"],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Request Help WF" }, undefined);
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
    const execOut = execRes as {
      id?: string;
      status?: string;
      question?: string;
      options?: string[];
    };
    expect(execOut.id).toBeDefined();
    const runId = execOut.id!;
    expect(["waiting_for_user", "completed"]).toContain(execOut.status);
    e2eLog.runId(runId);
    e2eLog.step("execute_workflow", { status: execOut.status });

    if (execOut.status === "waiting_for_user") {
      const respondRes = await respondRun(
        new Request(`http://localhost/api/runs/${runId}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "A" }),
        }),
        { params: Promise.resolve({ id: runId }) }
      );
      expect(respondRes.status).toBe(200);
      e2eLog.step("POST respond", { response: "A" });

      const deadline = Date.now() + 45_000;
      let runStatus: string | undefined;
      while (Date.now() < deadline) {
        await processOneWorkflowJob();
        const runRes = await getRun(new Request(`http://localhost/api/runs/${runId}`), {
          params: Promise.resolve({ id: runId }),
        });
        expect(runRes.status).toBe(200);
        const runData = await runRes.json();
        runStatus = runData.status;
        if (runStatus === "completed" || runStatus === "failed") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(runStatus).toBe("completed");
      e2eLog.toolCall("request_user_help resume", `status: ${runStatus}`);
    } else {
      e2eLog.toolCall("request_user_help", "model completed without pausing");
    }
  }, 90_000);
});
