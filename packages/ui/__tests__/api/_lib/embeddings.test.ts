import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { embed, getEncodingConfig } from "../../../app/api/_lib/embeddings";
import { POST as encPost } from "../../../app/api/rag/encoding-config/route";
import { POST as provPost } from "../../../app/api/rag/embedding-providers/route";
import { GET as llmListGet, POST as llmPost } from "../../../app/api/llm/providers/route";

describe("embeddings", () => {
  const savedFetch = globalThis.fetch;

  beforeAll(async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Embed test config",
          provider: "openai",
          modelOrEndpoint: "text-embedding-3-small",
          dimensions: 1536,
        }),
      })
    );
    if (encRes.status !== 201) {
      const list = await (await import("../../../app/api/rag/encoding-config/route")).GET();
      const arr = await list.json();
      if (Array.isArray(arr) && arr.length > 0) {
        (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId = arr[0].id;
      }
    } else {
      const d = await encRes.json();
      (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId = d.id;
    }
    const listRes = await llmListGet();
    const list = await listRes.json();
    if (!Array.isArray(list) || list.length === 0) {
      process.env.EMBED_TEST_KEY = "test-key";
      await llmPost(
        new Request("http://localhost/api/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "openai",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKeyRef: "EMBED_TEST_KEY",
          }),
        })
      );
    }
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  describe("getEncodingConfig", () => {
    it("returns null for unknown id", async () => {
      const config = await getEncodingConfig("non-existent-id-12345");
      expect(config).toBeNull();
    });

    it("returns config when id exists", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      const config = await getEncodingConfig(encId);
      expect(config).not.toBeNull();
      expect(config?.provider).toBe("openai");
      expect(config?.dimensions).toBe(1536);
    });

    it("returns embeddingProviderId and endpoint when set", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed test local",
            type: "local",
            endpoint: "http://localhost:11434",
          }),
        })
      );
      if (provRes.status !== 201) return;
      const prov = await provRes.json();
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc with provider",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "nomic-embed-text",
            dimensions: 768,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      const config = await getEncodingConfig(enc.id);
      expect(config).not.toBeNull();
      expect(config?.embeddingProviderId).toBe(prov.id);
      expect(config?.modelOrEndpoint).toBe("nomic-embed-text");
      expect(config?.dimensions).toBe(768);
    });
  });

  describe("embed", () => {
    it("returns empty array for empty texts", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      const result = await embed(encId, []);
      expect(result).toEqual([]);
    });

    it("throws when encoding config not found", async () => {
      await expect(embed("non-existent-enc-id", ["hello"])).rejects.toThrow(
        "Encoding config not found"
      );
    });

    it("returns vectors when API succeeds", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
      }) as typeof fetch;

      const result = await embed(encId, ["hello"]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    });

    it("throws when API returns non-ok", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      }) as typeof fetch;

      await expect(embed(encId, ["hello"])).rejects.toThrow("Embedding API error (401)");
    });

    it("throws when API returns wrong number of vectors", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1] }],
          }),
      }) as typeof fetch;

      await expect(embed(encId, ["a", "b"])).rejects.toThrow("returned 1 vectors for 2 inputs");
    });

    it("embed with embeddingProviderId (local) uses Ollama /api/embed and returns vectors", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed test local",
            type: "local",
            endpoint: "http://localhost:11434",
          }),
        })
      );
      if (provRes.status !== 201) return;
      const prov = await provRes.json();
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc local",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "nomic-embed-text",
            dimensions: 768,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.includes("/api/embed")) {
          const body = init?.body ? JSON.parse(init.body as string) : {};
          expect(body.model).toBe("nomic-embed-text");
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                embeddings: [
                  [0.1, 0.2, 0.3],
                  [0.4, 0.5, 0.6],
                ],
              }),
          });
        }
        return savedFetch(typeof url === "string" ? new URL(url) : (url as URL), init);
      }) as typeof fetch;

      const result = await embed(enc.id, ["a", "b"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result[1]).toEqual([0.4, 0.5, 0.6]);
    });

    it("embed with embeddingProviderId throws when provider not found", async () => {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc bad provider",
            embeddingProviderId: "non-existent-provider-id",
            modelOrEndpoint: "nomic-embed-text",
            dimensions: 768,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      await expect(embed(enc.id, ["hello"])).rejects.toThrow("Embedding provider not found");
    });

    it("throws when API returns data that is not an array", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: null }),
      }) as typeof fetch;
      await expect(embed(encId, ["hello"])).rejects.toThrow("returned 0 vectors for 1 inputs");
    });

    it("legacy path uses multiple texts in request body", async () => {
      const encId = (globalThis as { __embedTestConfigId?: string }).__embedTestConfigId;
      if (!encId) return;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          }),
      }) as typeof fetch;
      const result = await embed(encId, ["a", "b"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([0.1, 0.2]);
      expect(result[1]).toEqual([0.3, 0.4]);
    });
  });
});
