import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/skills/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/skills/[id]/route";

describe("Skills API", () => {
  let createdId: string;

  it("GET /api/skills returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/skills returns description and config as undefined when null", async () => {
    const res = await listPost(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Skill No Desc Config",
          type: "prompt",
          description: null,
          content: null,
        }),
      })
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    const listRes = await listGet();
    const data = await listRes.json();
    const found = data.find((s: { id: string }) => s.id === created.id);
    expect(found).toBeDefined();
    expect(found.description).toBeUndefined();
    expect(found.config).toBeUndefined();
  });

  it("GET /api/skills returns parsed config when present", async () => {
    const res = await listPost(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Skill With Config",
          type: "prompt",
          config: { key: "value" },
        }),
      })
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    const listRes = await listGet();
    const data = await listRes.json();
    const found = data.find((s: { id: string }) => s.id === created.id);
    expect(found).toBeDefined();
    expect(found.config).toEqual({ key: "value" });
  });

  it("POST /api/skills returns 400 for invalid JSON", async () => {
    const res = await listPost(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/skills creates skill", async () => {
    const res = await listPost(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Skill",
          type: "prompt",
          content: "You are helpful.",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Skill");
    expect(data.type).toBe("prompt");
    createdId = data.id;
  });

  it("GET /api/skills/:id returns skill", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/skills/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Skill");
  });

  it("GET /api/skills/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/skills/x"), {
      params: Promise.resolve({ id: "non-existent-skill-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("GET /api/skills/:id returns description and config as undefined when null", async () => {
    const postRes = await listPost(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Skill Null Fields", type: "prompt", content: null }),
      })
    );
    const created = await postRes.json();
    const res = await getOne(new Request("http://localhost/api/skills/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.description).toBeUndefined();
    expect(data.config).toBeUndefined();
  });

  it("GET /api/skills/:id returns parsed config when skill has config", async () => {
    const postRes = await listPost(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Skill With Config For Get",
          type: "prompt",
          config: { foo: "bar", count: 1 },
        }),
      })
    );
    const created = await postRes.json();
    const res = await getOne(new Request("http://localhost/api/skills/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config).toEqual({ foo: "bar", count: 1 });
  });

  it("PUT /api/skills/:id returns 404 for unknown id", async () => {
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Any" }),
      }),
      { params: Promise.resolve({ id: "non-existent-skill-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("PUT /api/skills/:id returns 400 for invalid JSON", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("PUT /api/skills/:id accepts config null to clear", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: null }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config).toBeUndefined();
  });

  it("PUT /api/skills/:id updates config with object", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { key: "value", count: 2 } }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config).toEqual({ key: "value", count: 2 });
  });

  it("PUT /api/skills/:id with empty body returns 200 and current skill unchanged", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Skill");
  });

  it("PUT /api/skills/:id updates only description", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Updated description only" }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.description).toBe("Updated description only");
  });

  it("PUT /api/skills/:id updates config with object", async () => {
    if (!createdId) return;
    const configObj = { enabled: true, count: 2 };
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configObj }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config).toEqual(configObj);
  });

  it("PUT /api/skills/:id with empty body returns current skill unchanged", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Test Skill");
  });

  it("PUT /api/skills/:id updates skill", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/skills/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Skill" }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Skill");
  });

  it("DELETE /api/skills/:id returns 404 for unknown id", async () => {
    const res = await deleteOne(
      new Request("http://localhost/api/skills/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "non-existent-skill-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("DELETE /api/skills/:id removes skill", async () => {
    if (!createdId) return;
    const res = await deleteOne(
      new Request("http://localhost/api/skills/x", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: createdId }),
      }
    );
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/skills/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
