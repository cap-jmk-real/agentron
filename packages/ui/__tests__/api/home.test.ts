import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/home/route";
import { POST as agentsPost } from "../../app/api/agents/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { POST as tasksPost } from "../../app/api/tasks/route";
import { db, tokenUsage } from "../../app/api/_lib/db";

describe("Home API", () => {
  it("GET /api/home returns workflows, tasks, agents, workflowsMap", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("workflows");
    expect(data).toHaveProperty("tasks");
    expect(data).toHaveProperty("agents");
    expect(data).toHaveProperty("workflowsMap");
    expect(Array.isArray(data.workflows)).toBe(true);
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(typeof data.agents).toBe("object");
    expect(typeof data.workflowsMap).toBe("object");
  });

  it("GET /api/home when pending tasks exist populates agents and workflowsMap", async () => {
    const agentRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Home Test Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const agentData = await agentRes.json();
    const agentId = agentData.id;

    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Home Test Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wfData = await wfRes.json();
    const workflowId = wfData.id;

    await tasksPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          agentId,
          stepId: "step-1",
          stepName: "Approve",
          label: "Home test task",
          status: "pending_approval",
        }),
      })
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.length).toBeGreaterThanOrEqual(1);
    expect(data.agents[agentId]).toBeDefined();
    expect(data.agents[agentId].name).toBe("Home Test Agent");
    expect(data.workflowsMap[workflowId]).toBeDefined();
    expect(data.workflowsMap[workflowId].name).toBe("Home Test Workflow");
  });

  it("GET /api/home includes workflow with null estimatedCost in cost reduce", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Home Null Cost Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        workflowId: wf.id,
        agentId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 1,
        completionTokens: 1,
        estimatedCost: null,
        createdAt: Date.now(),
      })
      .run();
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    const wfStat = data.workflows.find((w: { id: string }) => w.id === wf.id);
    expect(wfStat).toBeDefined();
    expect(wfStat.estimatedCost).toBe(0);
  });
});
