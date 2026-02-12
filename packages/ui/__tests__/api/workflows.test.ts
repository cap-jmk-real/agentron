import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/workflows/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/workflows/[id]/route";
import { POST as executePost } from "../../app/api/workflows/[id]/execute/route";

describe("Workflows API", () => {
  let createdId: string;

  it("GET /api/workflows returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/workflows creates workflow", async () => {
    const res = await listPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Workflow");
    createdId = data.id;
  });

  it("GET /api/workflows/:id returns workflow", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/workflows/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Workflow");
  });

  it("GET /api/workflows/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/workflows/x"), {
      params: Promise.resolve({ id: "non-existent-workflow-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("PUT /api/workflows/:id updates workflow", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/workflows/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Workflow");
  });

  it("POST /api/workflows/:id/execute returns run with status", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.targetType).toBe("workflow");
    expect(data.targetId).toBe(createdId);
    expect(["running", "completed", "failed", "cancelled"]).toContain(data.status);
  });

  it("DELETE /api/workflows/:id removes workflow", async () => {
    if (!createdId) return;
    const res = await deleteOne(new Request("http://localhost/api/workflows/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/workflows/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
