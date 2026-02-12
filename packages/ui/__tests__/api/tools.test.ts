import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/tools/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/tools/[id]/route";

describe("Tools API", () => {
  let createdId: string;

  it("GET /api/tools returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/tools creates tool", async () => {
    const res = await listPost(
      new Request("http://localhost/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Tool",
          protocol: "native",
          config: {},
          inputSchema: { type: "object", properties: {}, required: [] },
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Tool");
    createdId = data.id;
  });

  it("GET /api/tools/:id returns tool", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/tools/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Tool");
  });

  it("GET /api/tools/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/tools/x"), {
      params: Promise.resolve({ id: "non-existent-tool-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/tools/:id updates tool", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/tools/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Tool",
          protocol: "native",
          config: {},
          inputSchema: { type: "object", properties: {}, required: [] },
        }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Tool");
  });

  it("DELETE /api/tools/:id removes tool", async () => {
    if (!createdId) return;
    const res = await deleteOne(new Request("http://localhost/api/tools/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/tools/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
