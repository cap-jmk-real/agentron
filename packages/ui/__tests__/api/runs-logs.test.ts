import { describe, it, expect, beforeAll } from "vitest";
import { POST as executePost } from "../../app/api/agents/[id]/execute/route";
import { GET as agentsGet } from "../../app/api/agents/route";
import { POST as agentsPost } from "../../app/api/agents/route";
import { GET as runsGet } from "../../app/api/runs/route";
import { GET as runGet, PATCH as runPatch } from "../../app/api/runs/[id]/route";
import { GET as traceGet } from "../../app/api/runs/[id]/trace/route";
import { GET as eventsGet } from "../../app/api/runs/[id]/events/route";
import { GET as messagesGet } from "../../app/api/runs/[id]/messages/route";
import { GET as agentRequestGet } from "../../app/api/runs/[id]/agent-request/route";
import { GET as pendingHelpGet } from "../../app/api/runs/pending-help/route";

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
    const execRes = await executePost(new Request("http://localhost/api/agents/x/execute", { method: "POST" }), {
      params: Promise.resolve({ id: agentId }),
    });
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

  it("GET /api/runs/:id/trace returns 404 for non-existent run", async () => {
    const res = await traceGet(new Request("http://localhost/api/runs/nonexistent-id/trace"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
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

  it("GET /api/runs/:id/messages returns 404 for non-existent run", async () => {
    const res = await messagesGet(new Request("http://localhost/api/runs/nonexistent-id/messages"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
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

  it("GET /api/runs/:id/agent-request returns 404 for non-existent run", async () => {
    const res = await agentRequestGet(new Request("http://localhost/api/runs/nonexistent-id/agent-request"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
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

  it("GET /api/runs/:id/trace returns run metadata and trail when run has output.trail", async () => {
    const trail = [
      { nodeId: "n1", agentId: "a1", agentName: "Agent One", order: 0, input: "in", output: "out" },
    ];
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", output: { success: true, output: "done", trail } }),
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
});
