import { describe, it, expect, vi } from "vitest";
import { GET as listGet, POST as createPost } from "../../app/api/llm/providers/route";
import * as dbModule from "../../app/api/_lib/db";
import * as apiLogger from "../../app/api/_lib/api-logger";

describe("LLM Providers API", () => {
  let createdId: string;

  it("GET /api/llm/providers returns 500 when db throws", async () => {
    vi.spyOn(dbModule.db, "select").mockReturnValueOnce({
      from: () => Promise.reject(new Error("db connection failed")),
    } as never);
    const res = await listGet();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("db connection failed");
    vi.restoreAllMocks();
  });

  it("GET /api/llm/providers returns 500 with string message when thrown value is not Error", async () => {
    vi.spyOn(dbModule.db, "select").mockReturnValueOnce({
      from: () => Promise.reject("non-error throw"),
    } as never);
    const res = await listGet();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("non-error throw");
    vi.restoreAllMocks();
  });

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
    const list = (await listRes.json()) as Array<{
      id: string;
      apiKey?: string;
      apiKeyRef?: string;
    }>;
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

  it("POST /api/llm/providers stores contextLength from string in extra", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          contextLength: "4096",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.extra?.contextLength).toBe(4096);
  });

  it("POST /api/llm/providers returns 500 when body is invalid JSON", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {",
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/llm/providers stores rateLimit in extra", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          rateLimit: 60,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.extra?.rateLimit).toBe(60);
  });

  it("POST /api/llm/providers treats extra array as empty object for storage", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          extra: ["not", "an", "object"],
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.extra).toBeUndefined();
  });

  it("POST /api/llm/providers ignores contextLength when zero", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          contextLength: 0,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.extra?.contextLength).toBeUndefined();
  });

  it("POST /api/llm/providers returns 500 when logApiError throws in catch", async () => {
    vi.spyOn(apiLogger, "logApiError").mockImplementationOnce(() => {
      throw new Error("log failed");
    });
    vi.spyOn(dbModule.db, "insert").mockReturnValueOnce({
      values: () => ({
        run: () => Promise.reject(new Error("insert failed")),
      }),
    } as never);
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openai", model: "gpt-4o" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("insert failed");
    vi.restoreAllMocks();
  });

  it("POST /api/llm/providers stores contextLength when number", async () => {
    const res = await createPost(
      new Request("http://localhost/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          contextLength: 2048,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.extra?.contextLength).toBe(2048);
  });
});
