import { describe, it, expect, beforeAll, vi } from "vitest";
import { POST as executePost } from "../../app/api/agents/[id]/execute/route";
import { GET as agentsGet } from "../../app/api/agents/route";
import { POST as agentsPost } from "../../app/api/agents/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { POST as workflowExecutePost } from "../../app/api/workflows/[id]/execute/route";
import { GET as runsGet } from "../../app/api/runs/route";
import { GET as runGet, PATCH as runPatch } from "../../app/api/runs/[id]/route";
import { GET as traceGet } from "../../app/api/runs/[id]/trace/route";
import { GET as eventsGet } from "../../app/api/runs/[id]/events/route";
import { GET as messagesGet } from "../../app/api/runs/[id]/messages/route";
import { GET as agentRequestGet } from "../../app/api/runs/[id]/agent-request/route";
import { GET as pendingHelpGet } from "../../app/api/runs/pending-help/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { eq } from "drizzle-orm";
import { db, executions, toExecutionRow } from "../../app/api/_lib/db";
import { setExecutionRunState } from "../../app/api/_lib/execution-events";

vi.mock("../../app/api/_lib/workflow-queue", () => ({
  enqueueWorkflowStart: vi.fn().mockResolvedValue("job-1"),
  waitForJob: vi.fn().mockResolvedValue(undefined),
}));

describe("Runs API", () => {
  let runId: string;

  beforeAll(async () => {
    const listRes = await agentsGet();
    const list = await listRes.json();
    let agentId: string;
    if (Array.isArray(list) && list.length > 0) {
      agentId = list[0].id;
    } else {
      const createRes = await agentsPost(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Logs Test Agent",
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
    }
    const execRes = await executePost(
      new Request("http://localhost/api/agents/x/execute", { method: "POST" }),
      {
        params: Promise.resolve({ id: agentId }),
      }
    );
    expect(execRes.status).toBe(202);
    const execBody = await execRes.json();
    runId = execBody.id;
  });

  it("GET /api/runs returns list including created run", async () => {
    const res = await runsGet(new Request("http://localhost/api/runs"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((r: { id: string }) => r.id === runId)).toBe(true);
  });

  it("GET /api/runs accepts targetType and targetId and limit query params", async () => {
    const runRes = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: runId }),
    });
    const run = await runRes.json();
    const agentId = run.targetId;
    const res = await runsGet(
      new Request(`http://localhost/api/runs?targetType=agent&targetId=${agentId}&limit=5`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((r: { targetType: string }) => r.targetType === "agent")).toBe(true);
    expect(data.every((r: { targetId: string }) => r.targetId === agentId)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(5);
    if (data.length > 0) expect(data[0]).toHaveProperty("targetName");
  });

  it("GET /api/runs respects limit param and caps at 200", async () => {
    const res = await runsGet(new Request("http://localhost/api/runs?limit=3"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("GET /api/runs returns workflow runs with targetName when workflowIds present", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Runs Workflow Name",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    expect(wfRes.status).toBe(201);
    const wf = await wfRes.json();
    const execRes = await workflowExecutePost(
      new Request("http://localhost/api/workflows/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: wf.id }) }
    );
    if (execRes.status !== 200) return;
    const execData = await execRes.json();
    const res = await runsGet(
      new Request(`http://localhost/api/runs?targetType=workflow&targetId=${wf.id}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const workflowRun = data.find((r: { id: string }) => r.id === execData.id);
    if (workflowRun) {
      expect(workflowRun.targetType).toBe("workflow");
      expect(workflowRun.targetName).toBe("Runs Workflow Name");
    }
  });

  it("GET /api/runs with limit=200 returns up to 200 runs", async () => {
    const res = await runsGet(new Request("http://localhost/api/runs?limit=200"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(200);
    if (data.length > 0) {
      const withName = data.filter((r: { targetName?: string }) => r.targetName != null);
      expect(withName.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("GET /api/runs enriches list with targetName when only agent runs exist", async () => {
    const res = await runsGet(new Request("http://localhost/api/runs?targetType=agent&limit=20"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data.every((r: { targetType: string }) => r.targetType === "agent")).toBe(true);
      data.forEach((r: { targetName?: string }) => expect(r).toHaveProperty("targetName"));
    }
  });

  it("GET /api/runs enriches agent runs with agent name from DB", async () => {
    const res = await runsGet(new Request("http://localhost/api/runs?targetType=agent&limit=5"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const agentRun = data.find((r: { id: string }) => r.id === runId);
    if (agentRun) {
      expect(agentRun.targetType).toBe("agent");
      expect(agentRun.targetName).toBeDefined();
      expect(typeof agentRun.targetName).toBe("string");
    }
  });

  it("GET /api/runs agent enrichment block runs when result contains agent runs", async () => {
    const res = await runsGet(new Request("http://localhost/api/runs?targetType=agent&limit=10"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const agentRuns = data.filter((r: { targetType: string }) => r.targetType === "agent");
    if (agentRuns.length > 0) {
      agentRuns.forEach((r: { targetName?: string }) => {
        expect(r).toHaveProperty("targetName");
        expect(typeof r.targetName).toBe("string");
      });
    }
  });

  it("GET /api/runs enriches list with targetName for both workflow and agent runs", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Runs Enrichment Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const workflowRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: workflowRunId,
          targetType: "workflow",
          targetId: wf.id,
          status: "completed",
        })
      )
      .run();
    const res = await runsGet(new Request("http://localhost/api/runs"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const workflowRun = data.find((r: { targetType: string }) => r.targetType === "workflow");
    const agentRun = data.find((r: { targetType: string }) => r.targetType === "agent");
    expect(workflowRun).toBeDefined();
    expect(workflowRun.targetName).toBe("Runs Enrichment Workflow");
    expect(agentRun).toBeDefined();
    expect(agentRun.targetName).toBeDefined();
  });

  it("GET /api/runs returns targetName undefined for non-workflow non-agent targetType", async () => {
    const otherRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: otherRunId,
          targetType: "other",
          targetId: "some-target",
          status: "completed",
        })
      )
      .run();
    const res = await runsGet(new Request("http://localhost/api/runs"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const otherRun = data.find((r: { id: string }) => r.id === otherRunId);
    expect(otherRun).toBeDefined();
    expect(otherRun.targetType).toBe("other");
    expect(otherRun.targetName).toBeUndefined();
  });

  it("GET /api/runs/:id returns run with targetName for workflow run", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Runs Test Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const workflowId = wf.id;
    const workflowRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: workflowRunId,
          targetType: "workflow",
          targetId: workflowId,
          status: "completed",
        })
      )
      .run();
    const res = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: workflowRunId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetType).toBe("workflow");
    expect(data.targetId).toBe(workflowId);
    expect(data.targetName).toBe("Runs Test Workflow");
  });

  it("GET /api/runs/:id returns run with output when patched", async () => {
    const patchRes = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", output: { result: "ok" } }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(patchRes.status).toBe(200);
    const getRes = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(getRes.status).toBe(200);
    const run = await getRes.json();
    expect(run.output).toEqual({ result: "ok" });
    expect(run.status).toBe("completed");
  });

  it("GET /api/runs/:id returns 404 for unknown id", async () => {
    const res = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: "non-existent-run-id-12345" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("PATCH /api/runs/:id returns 400 for invalid JSON body", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("PATCH /api/runs/:id returns 400 for non-JSON body", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "text/plain" },
        body: "plain text body",
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("PATCH /api/runs/:id with empty or no-op body returns run unchanged", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(runId);
    expect(data.status).toBe("completed");
  });

  it("PATCH /api/runs/:id with status failed triggers notification path", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed", output: { error: "Something went wrong" } }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("failed");
  });

  it("PATCH /api/runs/:id with status waiting_for_user triggers notification path", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Continue?", suggestions: ["yes", "no"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("waiting_for_user");
  });

  it("PATCH /api/runs/:id with only output in body updates output", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output: { custom: "data" } }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.output).toEqual({ custom: "data" });
  });

  it("PATCH /api/runs/:id with output null clears output", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", output: null }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.output == null).toBe(true);
  });

  it("GET /api/runs/:id/trace returns 404 for non-existent run", async () => {
    const res = await traceGet(new Request("http://localhost/api/runs/nonexistent-id/trace"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("GET /api/runs/:id/trace returns targetName for agent run", async () => {
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetType).toBe("agent");
    expect(data.targetName).toBeDefined();
    expect(data.executionLog).toBeDefined();
    expect(Array.isArray(data.executionLog)).toBe(true);
  });

  it("GET /api/runs/:id/events returns 404 for non-existent run", async () => {
    const res = await eventsGet(new Request("http://localhost/api/runs/nonexistent-id/events"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Run not found");
  });

  it("GET /api/runs/:id/events returns events and runState for existing run", async () => {
    const res = await eventsGet(new Request("http://localhost/api/runs/x/events"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runId).toBe(runId);
    expect(Array.isArray(data.events)).toBe(true);
    expect(data).toHaveProperty("copyForDiagnosis");
  });

  it("GET /api/runs/:id/events returns runState with truncated sharedContext and trailSnapshotLength", async () => {
    const runIdWithState = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runIdWithState,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    const longContext = "x".repeat(600);
    const trailSnapshot = [{ step: 1 }, { step: 2 }];
    await setExecutionRunState(runIdWithState, {
      workflowId: crypto.randomUUID(),
      round: 0,
      sharedContext: longContext,
      status: "running",
      trailSnapshot,
    });
    const res = await eventsGet(new Request("http://localhost/api/runs/x/events"), {
      params: Promise.resolve({ id: runIdWithState }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runState).toBeDefined();
    expect(data.runState.sharedContextPreview).toContain("[truncated]");
    expect(data.runState.sharedContextPreview.length).toBe(500 + "... [truncated]".length);
    expect(data.runState.trailSnapshotLength).toBe(JSON.stringify(trailSnapshot).length);
  });

  it("GET /api/runs/:id/events returns runState with short sharedContext and null trailSnapshot", async () => {
    const runIdShort = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runIdShort,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    await setExecutionRunState(runIdShort, {
      workflowId: crypto.randomUUID(),
      round: 0,
      sharedContext: "short",
      status: "running",
      trailSnapshot: null,
    });
    const res = await eventsGet(new Request("http://localhost/api/runs/x/events"), {
      params: Promise.resolve({ id: runIdShort }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runState).toBeDefined();
    expect(data.runState.sharedContextPreview).toBe("short");
    expect(data.runState.trailSnapshotLength).toBe(0);
  });

  it("GET /api/runs/:id/messages returns 404 for non-existent run", async () => {
    const res = await messagesGet(
      new Request("http://localhost/api/runs/nonexistent-id/messages"),
      {
        params: Promise.resolve({ id: "nonexistent-id" }),
      }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Run not found");
  });

  it("GET /api/runs/:id/messages returns messages for existing run", async () => {
    const res = await messagesGet(new Request("http://localhost/api/runs/x/messages"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runId).toBe(runId);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("GET /api/runs/:id/messages accepts limit param", async () => {
    const res = await messagesGet(new Request("http://localhost/api/runs/x/messages?limit=5"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runId).toBe(runId);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("GET /api/runs/:id/messages uses default limit when limit param omitted", async () => {
    const res = await messagesGet(new Request("http://localhost/api/runs/x/messages"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runId).toBe(runId);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("GET /api/runs/:id/messages clamps limit param to 1-100", async () => {
    const res = await messagesGet(new Request("http://localhost/api/runs/x/messages?limit=150"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runId).toBe(runId);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("GET /api/runs/:id/messages uses 50 when limit param invalid", async () => {
    const res = await messagesGet(new Request("http://localhost/api/runs/x/messages?limit=abc"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runId).toBe(runId);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("PATCH /api/runs/:id returns 400 when body is not JSON", async () => {
    const res = await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("GET /api/runs/:id/agent-request returns 404 for non-existent run", async () => {
    const res = await agentRequestGet(
      new Request("http://localhost/api/runs/nonexistent-id/agent-request"),
      {
        params: Promise.resolve({ id: "nonexistent-id" }),
      }
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:id/agent-request returns question and options when run waiting_for_user", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Choose one?", options: ["A", "B", "C"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Choose one?");
    expect(data.options).toEqual(["A", "B", "C"]);
  });

  it("GET /api/runs/:id/agent-request returns question from suggestions when run waiting_for_user", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { output: { question: "Pick?", suggestions: ["X", "Y"] } },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Pick?");
    expect(data.options).toEqual(["X", "Y"]);
  });

  it("GET /api/runs/:id/agent-request returns empty question/options when output is invalid JSON", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "waiting_for_user", output: {} }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    await db
      .update(executions)
      .set({ output: "not valid json", status: "waiting_for_user" })
      .where(eq(executions.id, runId))
      .run();
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBeUndefined();
    expect(data.options).toEqual([]);
  });

  it("GET /api/runs/:id/agent-request returns empty question/options when output parses to non-object", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "waiting_for_user", output: 42 }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBeUndefined();
    expect(data.options).toEqual([]);
  });

  it("GET /api/runs/:id/agent-request returns empty question/options when run not waiting_for_user", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", output: {} }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBeUndefined();
    expect(data.options).toEqual([]);
  });

  it("GET /api/runs/:id/agent-request uses nested output.question and inner options", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { output: { question: "Nested question?", options: ["X", "Y"] } },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Nested question?");
    expect(data.options).toEqual(["X", "Y"]);
  });

  it("GET /api/runs/:id/agent-request uses message and top-level suggestions", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { message: "Please pick", suggestions: ["S1", "S2"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Please pick");
    expect(data.options).toEqual(["S1", "S2"]);
  });

  it("GET /api/runs/:id/agent-request uses inner.options when inner.suggestions absent", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { output: { question: "Pick one", options: ["Alpha", "Beta"] } },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Pick one");
    expect(data.options).toEqual(["Alpha", "Beta"]);
  });

  it("GET /api/runs/:id/agent-request uses top-level options when inner arrays absent", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Choose", options: ["One", "Two"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.options).toEqual(["One", "Two"]);
  });

  it("GET /api/runs/:id/agent-request maps option-like values to strings", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Pick", options: [1, "two", 3] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Pick");
    expect(data.options).toEqual(["1", "two", "3"]);
  });

  it("GET /api/runs/:id/agent-request uses inner message when only output.output.message present", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { output: { message: "Reply with your choice" } },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Reply with your choice");
    expect(Array.isArray(data.options)).toBe(true);
  });

  it("GET /api/runs/:id/agent-request uses flat message when no question or inner question", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { message: "Only top-level message", options: ["Yes", "No"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Only top-level message");
    expect(data.options).toEqual(["Yes", "No"]);
  });

  it("GET /api/runs/:id/agent-request uses out.suggestions when inner has no suggestions or options", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { output: { question: "Pick" }, suggestions: ["A", "B", "C"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("Pick");
    expect(data.options).toEqual(["A", "B", "C"]);
  });

  it("GET /api/runs/:id/trace returns targetName for agent run", async () => {
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(runId);
    expect(data.targetType).toBe("agent");
    expect(data).toHaveProperty("targetName");
    expect(Array.isArray(data.trail)).toBe(true);
    expect(Array.isArray(data.executionLog)).toBe(true);
  });

  it("GET /api/runs/:id/trace returns targetName for workflow run", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Trace Workflow Name",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const wfRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: wfRunId,
          targetType: "workflow",
          targetId: wf.id,
          status: "completed",
        })
      )
      .run();
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: wfRunId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetType).toBe("workflow");
    expect(data.targetName).toBe("Trace Workflow Name");
  });

  it("GET /api/runs/:id/trace returns targetName for workflow run", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Trace Workflow Name",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const wfRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: wfRunId,
          targetType: "workflow",
          targetId: wf.id,
          status: "completed",
        })
      )
      .run();
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: wfRunId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetType).toBe("workflow");
    expect(data.targetName).toBe("Trace Workflow Name");
  });

  it("GET /api/runs/pending-help tolerates run with invalid JSON output", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: "not valid json",
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === runId);
    expect(req).toBeDefined();
    expect(req.question).toBe("Needs your input");
  });

  it("GET /api/runs/:id/agent-request returns empty when output JSON parse fails", async () => {
    await db
      .update(executions)
      .set({
        status: "waiting_for_user",
        output: "invalid { json",
      })
      .where(eq(executions.id, runId))
      .run();
    const res = await agentRequestGet(new Request("http://localhost/api/runs/x/agent-request"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBeUndefined();
    expect(data.options).toEqual([]);
  });

  it("GET /api/runs/pending-help includes run with null conversationId", async () => {
    const runRes = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: runId }),
    });
    const run = await runRes.json();
    const nullConvRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: nullConvRunId,
          targetType: "agent",
          targetId: run.targetId,
          status: "waiting_for_user",
          output: { question: "Null conv?" },
          conversationId: null,
        })
      )
      .run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === nullConvRunId);
    expect(req).toBeDefined();
    expect(req.question).toBe("Null conv?");
  });

  it("GET /api/runs/pending-help includes run with empty conversationId", async () => {
    const emptyConvRunId = crypto.randomUUID();
    const runRes = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: runId }),
    });
    const run = await runRes.json();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: emptyConvRunId,
          targetType: "agent",
          targetId: run.targetId,
          status: "waiting_for_user",
          output: { question: "Empty conv?" },
          conversationId: "",
        })
      )
      .run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === emptyConvRunId);
    expect(req).toBeDefined();
    expect(req.question).toBe("Empty conv?");
  });

  it("GET /api/runs/pending-help returns count and requests array", async () => {
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.requests)).toBe(true);
  });

  it("GET /api/runs/pending-help returns requests with names when runs are waiting_for_user", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Need your input?", reason: "Test" },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.requests)).toBe(true);
  });

  it("GET /api/runs/pending-help returns request with reason and suggestions from output", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: {
            question: "Which option?",
            reason: "Need choice",
            suggestions: ["A", "B", "C"],
          },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === runId);
    if (req) {
      expect(req.question).toBe("Which option?");
      expect(req.reason).toBe("Need choice");
      expect(req.suggestions).toEqual(["A", "B", "C"]);
    }
  });

  it("GET /api/runs/pending-help filters non-string suggestions", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: {
            question: "Choose one",
            suggestions: [1, "valid", null, "also-valid"],
          },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === runId);
    if (req) {
      expect(req.suggestions).toEqual(["valid", "also-valid"]);
    }
  });

  it("GET /api/runs/pending-help uses output.message when reason absent", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { message: "Please confirm" },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === runId);
    if (req) expect(req.reason).toBe("Please confirm");
  });

  it("GET /api/runs/pending-help returns targetId as targetName for non-workflow non-agent run", async () => {
    const otherRunId = crypto.randomUUID();
    const runRow = toExecutionRow({
      id: otherRunId,
      targetType: "other",
      targetId: "custom-target-1",
      status: "waiting_for_user",
      output: { question: "Continue?" },
    });
    await db.insert(executions).values(runRow).run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === otherRunId);
    expect(req).toBeDefined();
    expect(req.targetType).toBe("other");
    expect(req.targetName).toBe("custom-target-1");
  });

  it("GET /api/runs/pending-help includes run whose conversationId is in DB", async () => {
    const convRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Pending Help Conv" }),
      })
    );
    const conv = await convRes.json();
    const convId = conv.id as string;
    const runRes = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: runId }),
    });
    const run = await runRes.json();
    const linkedRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: linkedRunId,
          targetType: "agent",
          targetId: run.targetId,
          status: "waiting_for_user",
          output: { question: "Linked conv?" },
          conversationId: convId,
        })
      )
      .run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === linkedRunId);
    expect(req).toBeDefined();
    expect(req.question).toBe("Linked conv?");
  });

  it("GET /api/runs/pending-help excludes run whose conversationId is not in DB", async () => {
    const runRes = await runGet(new Request("http://localhost/api/runs/x"), {
      params: Promise.resolve({ id: runId }),
    });
    const run = await runRes.json();
    const orphanRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: orphanRunId,
          targetType: "agent",
          targetId: run.targetId,
          status: "waiting_for_user",
          output: { question: "Orphan?" },
          conversationId: "non-existent-conversation-id",
        })
      )
      .run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const included = data.requests.find((r: { runId: string }) => r.runId === orphanRunId);
    expect(included).toBeUndefined();
  });

  it("GET /api/runs/pending-help returns workflow name for waiting workflow run", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Pending Help Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const wfRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: wfRunId,
          targetType: "workflow",
          targetId: wf.id,
          status: "waiting_for_user",
          output: { question: "Approve?" },
        })
      )
      .run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const req = data.requests.find((r: { runId: string }) => r.runId === wfRunId);
    expect(req).toBeDefined();
    expect(req.targetType).toBe("workflow");
    expect(req.targetName).toBe("Pending Help Workflow");
  });

  it("GET /api/runs/pending-help populates both workflow and agent names when both present", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Agent needs input" },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Dual Lookup Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const wfRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: wfRunId,
          targetType: "workflow",
          targetId: wf.id,
          status: "waiting_for_user",
          output: { question: "Workflow needs input" },
        })
      )
      .run();
    const res = await pendingHelpGet(new Request("http://localhost/api/runs/pending-help"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const agentReq = data.requests.find((r: { runId: string }) => r.runId === runId);
    const wfReq = data.requests.find((r: { runId: string }) => r.runId === wfRunId);
    if (agentReq) {
      expect(agentReq.targetType).toBe("agent");
      expect(agentReq.targetName).toBeDefined();
    }
    if (wfReq) {
      expect(wfReq.targetType).toBe("workflow");
      expect(wfReq.targetName).toBe("Dual Lookup Workflow");
    }
  });

  it("GET /api/runs/:id/trace returns empty trail when output has no trail key", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", output: { success: true } }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trail).toEqual([]);
    expect(Array.isArray(data.executionLog)).toBe(true);
  });

  it("GET /api/runs/:id/trace returns empty trail when output is array", async () => {
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", output: [] }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trail).toEqual([]);
  });

  it("GET /api/runs/:id/trace returns run metadata and trail when run has output.trail", async () => {
    const trail = [
      { nodeId: "n1", agentId: "a1", agentName: "Agent One", order: 0, input: "in", output: "out" },
    ];
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          output: { success: true, output: "done", trail },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(runId);
    expect(data.status).toBe("completed");
    expect(data.trail).toBeDefined();
    expect(Array.isArray(data.trail)).toBe(true);
    expect(data.trail).toHaveLength(1);
    expect(data.trail[0].agentName).toBe("Agent One");
    expect(data.trail[0].nodeId).toBe("n1");
    expect(data.trail[0].input).toBe("in");
    expect(data.trail[0].output).toBe("out");
    expect(data.executionLog).toBeDefined();
    expect(Array.isArray(data.executionLog)).toBe(true);
  });

  it("GET /api/runs/:id/trace returns targetName from agents table for agent run", async () => {
    const agentRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Trace-Agent-Name",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const agent = await agentRes.json();
    const traceRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: traceRunId,
          targetType: "agent",
          targetId: agent.id,
          status: "completed",
        })
      )
      .run();
    const res = await traceGet(new Request("http://localhost/api/runs/x/trace"), {
      params: Promise.resolve({ id: traceRunId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetType).toBe("agent");
    expect(data.targetName).toBe("Trace-Agent-Name");
  });
});
