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

  it("DELETE /api/skills/:id removes skill", async () => {
    if (!createdId) return;
    const res = await deleteOne(new Request("http://localhost/api/skills/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/skills/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
