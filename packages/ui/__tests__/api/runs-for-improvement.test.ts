import { describe, it, expect, beforeAll } from "vitest";
import { GET } from "../../app/api/runs/[id]/for-improvement/route";
import { POST as executePost } from "../../app/api/agents/[id]/execute/route";
import { GET as agentsGet, POST as agentsPost } from "../../app/api/agents/route";

describe("Runs for-improvement API", () => {
  let runId: string;

  beforeAll(async () => {
    let agentId: string;
    const listRes = await agentsGet();
    const list = await listRes.json();
    if (Array.isArray(list) && list.length > 0) {
      agentId = list[0].id;
    } else {
      const createRes = await agentsPost(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "For-improvement Agent",
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

  it("GET /api/runs/:id/for-improvement returns 404 for non-existent run", async () => {
    const res = await GET(new Request("http://localhost/api/runs/x/for-improvement"), {
      params: Promise.resolve({ id: "non-existent-run-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("GET /api/runs/:id/for-improvement returns 200 with run context for existing run", async () => {
    const res = await GET(new Request("http://localhost/api/runs/x/for-improvement"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("id");
    expect(data.id).toBe(runId);
  });

  it("GET /api/runs/:id/for-improvement accepts includeFullLogs param", async () => {
    const res = await GET(new Request(`http://localhost/api/runs/x/for-improvement?includeFullLogs=true`), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(runId);
  });
});
