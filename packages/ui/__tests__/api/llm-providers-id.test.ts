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
});
