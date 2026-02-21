import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/llm/providers/route";
import { PUT as putOne, DELETE as deleteOne } from "../../app/api/llm/providers/[id]/route";

describe("LLM Providers [id] API", () => {
  let createdId: string;

  it("PUT /api/llm/providers/:id updates config", async () => {
    const createRes = await listPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          apiKeyRef: "OPENAI_API_KEY",
        }),
      })
    );
    const created = await createRes.json();
    createdId = created.id;

    const res = await putOne(
      new Request("http://localhost/api/llm/providers/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openai", model: "gpt-4o", rateLimit: 60 }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe("gpt-4o");
  });

  it("DELETE /api/llm/providers/:id removes config", async () => {
    const res = await deleteOne(
      new Request("http://localhost/api/llm/providers/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const listRes = await listGet();
    const list = await listRes.json();
    expect(list.find((p: { id: string }) => p.id === createdId)).toBeUndefined();
  });

  it("PUT /api/llm/providers/:id accepts contextLength as string number", async () => {
    const createRes = await listPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          apiKeyRef: "KEY",
        }),
      })
    );
    const created = await createRes.json();
    const res = await putOne(
      new Request("http://localhost/api/llm/providers/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextLength: "8192" }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.extra?.contextLength).toBe(8192);
  });

  it("PUT /api/llm/providers/:id merges existing apiKey when payload apiKey empty", async () => {
    const createRes = await listPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          endpoint: "https://api.openai.com/v1",
          apiKey: "secret-from-create",
        }),
      })
    );
    const created = await createRes.json();
    const res = await putOne(
      new Request("http://localhost/api/llm/providers/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          endpoint: "https://api.openai.com/v1",
          rateLimit: 30,
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.extra).toBeDefined();
    expect(data.extra?.apiKey).toBeUndefined();
  });

  it("PUT /api/llm/providers/:id returns 500 when update fails", async () => {
    const res = await putOne(
      new Request("http://localhost/api/llm/providers/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});
