import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/functions/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/functions/[id]/route";

describe("Functions API", () => {
  let createdId: string;

  it("GET /api/functions returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/functions creates function and tool", async () => {
    const res = await listPost(
      new Request("http://localhost/api/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Function",
          description: "A test",
          language: "javascript",
          source: "return 1 + 1;",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    createdId = data.id;
    expect(data.name).toBe("Test Function");
    expect(data.toolId).toBeDefined();
    expect(String(data.toolId).startsWith("fn-")).toBe(true);
  });

  it("GET /api/functions/:id returns function", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/functions/x"), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Function");
  });

  it("GET /api/functions/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/functions/x"), { params: Promise.resolve({ id: "non-existent-fn-id" }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("PUT /api/functions/:id updates function", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/functions/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Function", description: "Updated", language: "javascript", source: "return 2;" }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Function");
  });

  it("DELETE /api/functions/:id removes function", async () => {
    if (!createdId) return;
    const res = await deleteOne(new Request("http://localhost/api/functions/x", { method: "DELETE" }), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const getRes = await getOne(new Request("http://localhost/api/functions/x"), { params: Promise.resolve({ id: createdId }) });
    expect(getRes.status).toBe(404);
  });
});
