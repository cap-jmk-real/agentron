import { describe, it, expect, beforeAll } from "vitest";
import { POST as executePost } from "../../app/api/agents/[id]/execute/route";
import { GET as agentsGet } from "../../app/api/agents/route";
import { POST as agentsPost } from "../../app/api/agents/route";
import { GET as runsGet } from "../../app/api/runs/route";
import { GET as runGet, PATCH as runPatch } from "../../app/api/runs/[id]/route";
import { GET as logsGet, POST as logsPost } from "../../app/api/runs/[id]/logs/route";
import { GET as traceGet } from "../../app/api/runs/[id]/trace/route";

describe("Runs logs API", () => {
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
    const res = await runsGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((r: { id: string }) => r.id === runId)).toBe(true);
  });

  it("GET /api/runs/:id/logs returns empty array when no logs", async () => {
    const res = await logsGet(new Request("http://localhost/api/runs/x/logs"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it("POST /api/runs/:id/logs appends log entries", async () => {
    const res = await logsPost(
      new Request("http://localhost/api/runs/x/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logs: [
            { level: "info", message: "Step started" },
            { level: "debug", message: "Detail", payload: { key: "value" } },
          ],
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);
  });

  it("GET /api/runs/:id/logs returns appended logs", async () => {
    const res = await logsGet(new Request("http://localhost/api/runs/x/logs"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].level).toBe("info");
    expect(data[0].message).toBe("Step started");
    expect(data[1].payload).toEqual({ key: "value" });
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

  it("GET /api/runs/:id/trace returns 404 for non-existent run", async () => {
    const res = await traceGet(new Request("http://localhost/api/runs/nonexistent-id/trace"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
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
  });
});
