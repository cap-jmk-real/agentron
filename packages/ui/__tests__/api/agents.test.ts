import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/agents/route";
import { GET as getOne, DELETE as deleteOne } from "../../app/api/agents/[id]/route";
import { GET as workflowUsageGet } from "../../app/api/agents/[id]/workflow-usage/route";

describe("Agents API", () => {
  let createdId: string;

  it("GET /api/agents returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/agents creates agent", async () => {
    const res = await listPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Agent");
    createdId = data.id;
  });

  it("GET /api/agents/:id returns agent", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/agents/x"), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Agent");
  });

  it("GET /api/agents/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/agents/x"), { params: Promise.resolve({ id: "non-existent-id-12345" }) });
    expect(res.status).toBe(404);
  });

  it("GET /api/agents/:id/workflow-usage returns workflows array", async () => {
    if (!createdId) return;
    const res = await workflowUsageGet(new Request("http://localhost/api/agents/x/workflow-usage"), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.workflows)).toBe(true);
  });

  it("DELETE /api/agents/:id removes agent", async () => {
    if (!createdId) return;
    const res = await deleteOne(new Request("http://localhost/api/agents/x", { method: "DELETE" }), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/agents/x"), { params: Promise.resolve({ id: createdId }) });
    expect(getRes.status).toBe(404);
  });
});
