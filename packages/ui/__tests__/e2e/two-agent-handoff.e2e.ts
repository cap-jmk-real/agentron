/**
 * E2E: Two-agent handoff — workflow A → B, run and assert trail has A output and B output.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e two-agent-handoff", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("two-agent-handoff");
    e2eLog.scenario("two-agent-handoff", "Agent A → Agent B, trail has both outputs");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("workflow with two agents: A then B, trail contains From A and B received", async () => {
    const agentARes = await executeTool(
      "create_agent",
      {
        name: "E2E Agent A",
        description: "Sends message to B",
        systemPrompt: "Reply with exactly: From A.",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentARes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentAId = (agentARes as { id?: string }).id;
    expect(typeof agentAId).toBe("string");

    const agentBRes = await executeTool(
      "create_agent",
      {
        name: "E2E Agent B",
        description: "Receives from A",
        systemPrompt:
          "Reply with exactly: B received the previous message. Do not add anything else.",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentBRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentBId = (agentBRes as { id?: string }).id;
    expect(typeof agentBId).toBe("string");
    e2eLog.step("create_agent A and B", { agentAId, agentBId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Two-Agent WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;
    e2eLog.step("create_workflow", { workflowId });

    const updateRes = await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [
          { id: "nA", type: "agent", position: [0, 0], parameters: { agentId: agentAId } },
          { id: "nB", type: "agent", position: [200, 0], parameters: { agentId: agentBId } },
        ],
        edges: [{ id: "e1", source: "nA", target: "nB" }],
        maxRounds: 2,
      },
      undefined
    );
    expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));

    const execRes = await executeTool("execute_workflow", { workflowId }, undefined);
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    const out = execRes as { status?: string; output?: unknown };
    expect(out.status).toBe("completed");
    const parsed =
      typeof out.output === "string"
        ? (JSON.parse(out.output) as { trail?: { output?: string }[] })
        : ((out.output as { trail?: { output?: string }[] }) ?? {});
    const trail = Array.isArray(parsed.trail) ? parsed.trail : [];
    const trailText = trail
      .map((s) => (typeof s.output === "string" ? s.output : JSON.stringify(s.output ?? "")))
      .join(" ");
    expect(trailText).toMatch(/From A\.?/i);
    expect(trailText).toMatch(/B received/i);
    e2eLog.runId((execRes as { id?: string }).id!);
    e2eLog.toolCall("execute_workflow", `trail steps: ${trail.length}`);
  }, 60_000);
});
