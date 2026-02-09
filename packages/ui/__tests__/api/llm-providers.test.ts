import { describe, it, expect } from "vitest";
import { GET as listGet, POST as createPost } from "../../app/api/llm/providers/route";

describe("LLM Providers API", () => {
  let createdId: string;

  it("GET /api/llm/providers returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/llm/providers does not persist apiKey (only apiKeyRef)", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          apiKey: "sk-secret-must-not-appear",
          apiKeyRef: "OPENAI_API_KEY",
        }),
      })
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    createdId = created.id;
    expect(created.apiKey).toBeUndefined();
    expect(created.apiKeyRef).toBe("OPENAI_API_KEY");

    const listRes = await listGet();
    const list = (await listRes.json()) as Array<{ id: string; apiKey?: string; apiKeyRef?: string }>;
    const found = list.find((p) => p.id === createdId);
    expect(found).toBeDefined();
    expect(found!.apiKey).toBeUndefined();
    expect(found!.apiKeyRef).toBe("OPENAI_API_KEY");
  });

  it("GET /api/llm/providers returns configs without apiKey in extra", async () => {
    const res = await listGet();
    const list = (await res.json()) as Array<{ extra?: { apiKey?: string } }>;
    for (const p of list) {
      if (p.extra && typeof p.extra === "object") {
        expect((p.extra as Record<string, unknown>).apiKey).toBeUndefined();
      }
    }
  });
});
