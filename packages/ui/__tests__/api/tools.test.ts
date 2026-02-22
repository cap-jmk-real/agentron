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

  it("POST /api/tools accepts optional id in body", async () => {
    const customId = "custom-tool-id-12345";
    const res = await listPost(
      new Request("http://localhost/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customId,
          name: "Custom Id Tool",
          protocol: "native",
          config: {},
          inputSchema: { type: "object", properties: {}, required: [] },
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(customId);
    expect(data.name).toBe("Custom Id Tool");
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

  it("PUT /api/tools/:id returns 404 for unknown id", async () => {
    const res = await putOne(
      new Request("http://localhost/api/tools/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "No Such Tool",
          protocol: "native",
          config: {},
          inputSchema: { type: "object", properties: {}, required: [] },
        }),
      }),
      { params: Promise.resolve({ id: "non-existent-tool-id" }) }
    );
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

  it("PUT /api/tools/:id updates only inputSchema for standard tool", async () => {
    const listRes = await listGet();
    const list = await listRes.json();
    const stdTool = list.find((t: { id: string }) => t.id.startsWith("std-"));
    if (!stdTool) return;
    const newSchema = { type: "object", properties: { x: { type: "string" } }, required: [] };
    const res = await putOne(
      new Request("http://localhost/api/tools/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputSchema: newSchema }),
      }),
      { params: Promise.resolve({ id: stdTool.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inputSchema).toEqual(newSchema);
    expect(data.id).toBe(stdTool.id);
  });

  it("PUT /api/tools/:id updates only outputSchema for standard tool", async () => {
    const listRes = await listGet();
    const list = await listRes.json();
    const stdTool = list.find((t: { id: string }) => t.id.startsWith("std-"));
    if (!stdTool) return;
    const newOutputSchema = { type: "object", properties: { result: { type: "string" } } };
    const res = await putOne(
      new Request("http://localhost/api/tools/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputSchema: newOutputSchema }),
      }),
      { params: Promise.resolve({ id: stdTool.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.outputSchema).toEqual(newOutputSchema);
    expect(data.id).toBe(stdTool.id);
  });

  it("PUT /api/tools/:id with empty body for standard tool keeps existing schemas", async () => {
    const listRes = await listGet();
    const list = await listRes.json();
    const stdTool = list.find((t: { id: string }) => t.id.startsWith("std-"));
    if (!stdTool) return;
    const res = await putOne(
      new Request("http://localhost/api/tools/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: stdTool.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(stdTool.id);
    expect(data.inputSchema).toEqual(stdTool.inputSchema);
    expect(data.outputSchema).toEqual(stdTool.outputSchema);
  });

  it("DELETE /api/tools/:id returns 400 for standard tool", async () => {
    const listRes = await listGet();
    const list = await listRes.json();
    const stdTool = list.find((t: { id: string }) => t.id.startsWith("std-"));
    if (!stdTool) return;
    const res = await deleteOne(new Request("http://localhost/api/tools/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: stdTool.id }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("cannot be deleted");
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
