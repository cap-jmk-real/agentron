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

  it("GET /api/stats/agents returns lastRun null for agent with no token usage", async () => {
    const createRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "No Usage Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const created = await createRes.json();
    const res = await agentsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const agentStat = data.agents.find((a: { id: string }) => a.id === created.id);
    expect(agentStat).toBeDefined();
    expect(agentStat.totalRuns).toBe(0);
    expect(agentStat.lastRun).toBeNull();
  });

  it("GET /api/stats/agents handles token usage with null estimatedCost", async () => {
    const createRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Null Cost Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const created = await createRes.json();
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: created.id,
        workflowId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 5,
        completionTokens: 5,
        estimatedCost: null,
        createdAt: Date.now(),
      })
      .run();
    const res = await agentsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const agentStat = data.agents.find((a: { id: string }) => a.id === created.id);
    expect(agentStat).toBeDefined();
    expect(agentStat.estimatedCost).toBeDefined();
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

  it("GET /api/stats/agents includes chat usage when token rows have no agentId or workflowId", async () => {
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: null,
        workflowId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 10,
        completionTokens: 5,
        estimatedCost: "0.0001",
        createdAt: Date.now(),
      })
      .run();
    const res = await agentsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chat).toBeDefined();
    expect(data.chat.totalRuns).toBeGreaterThanOrEqual(1);
    expect(data.chat.promptTokens).toBeGreaterThanOrEqual(10);
  });

  it("GET /api/stats/agents includes chat usage with null estimatedCost in reduce", async () => {
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: null,
        workflowId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 2,
        completionTokens: 1,
        estimatedCost: null,
        createdAt: Date.now(),
      })
      .run();
    const res = await agentsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chat).toBeDefined();
    expect(data.chat.estimatedCost).toBeDefined();
  });

  it("GET /api/stats/workflows includes workflow with null estimatedCost in reduce", async () => {
    const createRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Null Cost Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const created = await createRes.json();
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: null,
        workflowId: created.id,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 1,
        completionTokens: 1,
        estimatedCost: null,
        createdAt: Date.now(),
      })
      .run();
    const res = await workflowsListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const wfStat = data.workflows.find((w: { id: string }) => w.id === created.id);
    expect(wfStat).toBeDefined();
    expect(wfStat.estimatedCost).toBeDefined();
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

  it("GET /api/stats/agents/:id includes run with null estimatedCost as 0", async () => {
    const createRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Agent Null Cost Run",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const created = await createRes.json();
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: created.id,
        workflowId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 1,
        completionTokens: 1,
        estimatedCost: null,
        createdAt: Date.now(),
      })
      .run();
    const res = await agentStatsGet(new Request("http://localhost/api/stats/agents/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs.length).toBe(1);
    expect(data.runs[0].estimatedCost).toBe(0);
  });

  it("GET /api/stats/agents/:id mixes null and non-null estimatedCost in byDay and runs", async () => {
    const createRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stats Agent Mixed Cost",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const created = await createRes.json();
    const now = Date.now();
    await db
      .insert(tokenUsage)
      .values([
        {
          id: crypto.randomUUID(),
          agentId: created.id,
          workflowId: null,
          provider: "openai",
          model: "gpt-4",
          promptTokens: 5,
          completionTokens: 5,
          estimatedCost: null,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          agentId: created.id,
          workflowId: null,
          provider: "openai",
          model: "gpt-4",
          promptTokens: 10,
          completionTokens: 10,
          estimatedCost: "0.001",
          createdAt: now + 1,
        },
      ])
      .run();
    const res = await agentStatsGet(new Request("http://localhost/api/stats/agents/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.totalRuns).toBe(2);
    expect(data.runs.length).toBe(2);
    const withZero = data.runs.find((r: { estimatedCost: number }) => r.estimatedCost === 0);
    const withCost = data.runs.find((r: { estimatedCost: number }) => r.estimatedCost > 0);
    expect(withZero).toBeDefined();
    expect(withCost).toBeDefined();
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

    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId,
        workflowId: null,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 10,
        completionTokens: 5,
        estimatedCost: "0.0001",
        createdAt: Date.now(),
      })
      .run();

    const res = await agentStatsGet(new Request("http://localhost/api/stats/agents/x"), {
      params: Promise.resolve({ id: agentId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("agent");
    expect(data.agent.id).toBe(agentId);
    expect(data.summary.totalRuns).toBe(1);
    expect(data.summary.promptTokens).toBe(10);
    expect(Array.isArray(data.timeSeries)).toBe(true);
    expect(data.timeSeries.length).toBeGreaterThan(0);
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.runs.length).toBe(1);
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

  it("GET /api/stats/workflows/:id returns agent breakdown when workflow has token usage", async () => {
    if (!workflowId || !agentId) return;
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId,
        workflowId,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 30,
        completionTokens: 20,
        estimatedCost: "0.0002",
        createdAt: Date.now(),
      })
      .run();
    const res = await workflowStatsGet(new Request("http://localhost/api/stats/workflows/x"), {
      params: Promise.resolve({ id: workflowId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.totalRuns).toBe(1);
    expect(data.summary.promptTokens).toBe(30);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThan(0);
    expect(data.agents[0]).toHaveProperty("name");
    expect(data.agents[0]).toHaveProperty("promptTokens");
    expect(data.agents[0]).toHaveProperty("estimatedCost");
  });

  it("GET /api/stats/workflows/:id includes null estimatedCost in totalCost reduce", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Workflow Null Cost Row",
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
        agentId: null,
        workflowId: wf.id,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 2,
        completionTokens: 1,
        estimatedCost: null,
        createdAt: Date.now(),
      })
      .run();
    const res = await workflowStatsGet(new Request("http://localhost/api/stats/workflows/x"), {
      params: Promise.resolve({ id: wf.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.totalRuns).toBe(1);
    expect(data.summary.estimatedCost).toBe(0);
  });

  it("GET /api/stats/workflows/:id returns Unknown for agent not in DB", async () => {
    const createRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Workflow Unknown Agent",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const created = await createRes.json();
    await db
      .insert(tokenUsage)
      .values({
        id: crypto.randomUUID(),
        agentId: "deleted-or-unknown-agent-id",
        workflowId: created.id,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 5,
        completionTokens: 5,
        estimatedCost: "0",
        createdAt: Date.now(),
      })
      .run();
    const res = await workflowStatsGet(new Request("http://localhost/api/stats/workflows/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const agentEntry = data.agents.find(
      (a: { id: string }) => a.id === "deleted-or-unknown-agent-id"
    );
    expect(agentEntry).toBeDefined();
    expect(agentEntry.name).toBe("Unknown");
  });

  it("GET /api/stats/workflows/:id sorts agents by token usage and handles null estimatedCost", async () => {
    const workflowRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Workflow Multi Agent Stats",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const workflow = await workflowRes.json();
    const agentARes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Agent A",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const agentA = await agentARes.json();
    const agentBRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Agent B",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const agentB = await agentBRes.json();
    await db
      .insert(tokenUsage)
      .values([
        {
          id: crypto.randomUUID(),
          agentId: agentA.id,
          workflowId: workflow.id,
          provider: "openai",
          model: "gpt-4",
          promptTokens: 100,
          completionTokens: 50,
          estimatedCost: "0.001",
          createdAt: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          agentId: agentB.id,
          workflowId: workflow.id,
          provider: "openai",
          model: "gpt-4",
          promptTokens: 10,
          completionTokens: 5,
          estimatedCost: null,
          createdAt: Date.now(),
        },
      ])
      .run();
    const res = await workflowStatsGet(new Request("http://localhost/api/stats/workflows/x"), {
      params: Promise.resolve({ id: workflow.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.totalRuns).toBe(2);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBe(2);
    const first = data.agents[0];
    const second = data.agents[1];
    expect(first.promptTokens + first.completionTokens).toBeGreaterThanOrEqual(
      second.promptTokens + second.completionTokens
    );
  });
});
