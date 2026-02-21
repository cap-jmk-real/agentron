import { describe, it, expect, beforeAll } from "vitest";
import { GET as listGet, POST as postProv } from "../../app/api/rag/embedding-providers/route";
import {
  GET as getProv,
  PUT as putProv,
  DELETE as deleteProv,
} from "../../app/api/rag/embedding-providers/[id]/route";
import { GET as modelsGet } from "../../app/api/rag/embedding-providers/[id]/models/route";

describe("RAG embedding providers API", () => {
  let id: string;

  it("GET /api/rag/embedding-providers returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/rag/embedding-providers returns 400 for invalid JSON", async () => {
    const res = await postProv(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/rag/embedding-providers returns 400 when name and type missing", async () => {
    const res = await postProv(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/rag/embedding-providers creates local provider", async () => {
    const res = await postProv(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E Ollama",
          type: "local",
          endpoint: "http://localhost:11434",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("E2E Ollama");
    expect(data.type).toBe("local");
    expect(data.endpoint).toBe("http://localhost:11434");
    expect(data.apiKey).toBeUndefined();
    expect(typeof data.apiKeySet).toBe("boolean");
    id = data.id;
  });

  it("GET /api/rag/embedding-providers list does not expose raw API key", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = Array.isArray(data) && data.find((p: { id: string }) => p.id === id);
    if (found) {
      expect(found.apiKey).toBeUndefined();
    }
  });

  it("GET /api/rag/embedding-providers/:id returns provider", async () => {
    const res = await getProv(new Request("http://localhost/x"), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(id);
    expect(data.name).toBe("E2E Ollama");
    expect(data.apiKey).toBeUndefined();
  });

  it("GET /api/rag/embedding-providers/:id returns 404 for unknown id", async () => {
    const res = await getProv(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/rag/embedding-providers/:id updates name", async () => {
    const res = await putProv(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ollama local" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Ollama local");
  });

  it("DELETE /api/rag/embedding-providers/:id deletes provider", async () => {
    const res = await deleteProv(new Request("http://localhost/x"), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const getRes = await getProv(new Request("http://localhost/x"), {
      params: Promise.resolve({ id }),
    });
    expect(getRes.status).toBe(404);
  });

  it("DELETE /api/rag/embedding-providers/:id returns 404 for unknown id", async () => {
    const res = await deleteProv(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("RAG embedding providers models API", () => {
  let localProviderId: string;

  beforeAll(async () => {
    const res = await postProv(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Local for models",
          type: "local",
          endpoint: "http://localhost:11434",
        }),
      })
    );
    if (res.status === 201) {
      const data = await res.json();
      localProviderId = data.id;
    } else {
      localProviderId = "";
    }
  });

  it("GET /api/rag/embedding-providers/:id/models returns 400 for non-local provider", async () => {
    const postRes = await postProv(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "OpenAI for models test",
          type: "openai",
        }),
      })
    );
    if (postRes.status !== 201) return;
    const openaiId = (await postRes.json()).id;
    const res = await modelsGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: openaiId }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/rag/embedding-providers/:id/models returns 404 for unknown id", async () => {
    const res = await modelsGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "non-existent" }),
    });
    expect(res.status).toBe(404);
  });
});
