import { describe, it, expect } from "vitest";
import { GET as agentsListGet } from "../../app/api/stats/agents/route";
import { GET as agentStatsGet } from "../../app/api/stats/agents/[id]/route";
import { GET as workflowsListGet } from "../../app/api/stats/workflows/route";
import { GET as workflowStatsGet } from "../../app/api/stats/workflows/[id]/route";
import { POST as agentsPost } from "../../app/api/agents/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { db, tokenUsage } from "../../app/api/_lib/db";

describe("Stats API", () => {
  let agentId: string;
  let workflowId: string;

  it("GET /api/stats/agents returns agents, chat, totals", async () => {
    const res = await agentsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("agents");
    expect(data).toHaveProperty("chat");
    expect(data).toHaveProperty("totals");
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it("GET /api/stats/agents includes token usage when present", async () => {
    const createRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Usage Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const created = await createRes.json();
    const aid = created.id;
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: aid,
        workflowId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 100,
        completionTokens: 50,
        estimatedCost: "0.001",
        createdAt: Date.now(),
      })
      .run();
    const res = await agentsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const agentStat = data.agents.find((a: { id: string }) => a.id === aid);
    expect(agentStat).toBeDefined();
    expect(agentStat.totalRuns).toBe(1);
    expect(agentStat.promptTokens).toBe(100);
    expect(agentStat.completionTokens).toBe(50);
    expect(agentStat.totalTokens).toBe(150);
  });

  it("GET /api/stats/workflows returns workflows array", async () => {
    const res = await workflowsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("workflows");
    expect(Array.isArray(data.workflows)).toBe(true);
  });

  it("GET /api/stats/workflows includes token usage when present", async () => {
    const createRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Usage Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const created = await createRes.json();
    const wid = created.id;
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: null,
        workflowId: wid,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 200,
        completionTokens: 80,
        estimatedCost: "0.002",
        createdAt: Date.now(),
      })
      .run();
    const res = await workflowsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const wfStat = data.workflows.find((w: { id: string }) => w.id === wid);
    expect(wfStat).toBeDefined();
    expect(wfStat.totalRuns).toBe(1);
    expect(wfStat.promptTokens).toBe(200);
    expect(wfStat.completionTokens).toBe(80);
    expect(wfStat.agentCount).toBe(0);
    expect(wfStat.llmCount).toBe(1);
  });

  it("GET /api/stats/agents/:id returns 404 for unknown agent", async () => {
    const res = await agentStatsGet(new Request("http://localhost/api/stats/agents/x"), {
      params: Promise.resolve({ id: "non-existent-agent-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/stats/agents/:id returns stats for existing agent", async () => {
    const createRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const created = await createRes.json();
    agentId = created.id;

    const res = await agentStatsGet(new Request("http://localhost/api/stats/agents/x"), {
      params: Promise.resolve({ id: agentId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("agent");
    expect(data.agent.id).toBe(agentId);
  });

  it("GET /api/stats/workflows/:id returns 404 for unknown workflow", async () => {
    const res = await workflowStatsGet(new Request("http://localhost/api/stats/workflows/x"), {
      params: Promise.resolve({ id: "non-existent-workflow-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/stats/workflows/:id returns stats for existing workflow", async () => {
    const createRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const created = await createRes.json();
    workflowId = created.id;

    const res = await workflowStatsGet(new Request("http://localhost/api/stats/workflows/x"), {
      params: Promise.resolve({ id: workflowId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("workflow");
    expect(data.workflow.id).toBe(workflowId);
  });
});
