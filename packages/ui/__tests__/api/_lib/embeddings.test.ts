import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { embed, getEncodingConfig } from "../../../app/api/_lib/embeddings";
import { POST as encPost } from "../../../app/api/rag/encoding-config/route";
import { POST as provPost } from "../../../app/api/rag/embedding-providers/route";
import { GET as llmListGet, POST as llmPost } from "../../../app/api/llm/providers/route";
import { db } from "../../../app/api/_lib/db";
import { ragEmbeddingProviders, ragEncodingConfigs } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

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

    it("legacy path throws when no API key for provider", async () => {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc no key",
            provider: "no-key-provider-xyz",
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      await expect(embed(enc.id, ["hello"])).rejects.toThrow(
        /No API key configured for embedding provider/
      );
    });

    it("embed with embeddingProviderId (openai) uses API key from env and returns vectors", async () => {
      const prevEnv = process.env.EMBED_PROVIDER_KEY;
      process.env.EMBED_PROVIDER_KEY = "secret-key-from-env";
      try {
        const provRes = await provPost(
          new Request("http://localhost/api/rag/embedding-providers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Embed openai via provider",
              type: "openai",
              endpoint: "https://api.openai.com/v1",
              apiKeyRef: "EMBED_PROVIDER_KEY",
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
              name: "Enc openai provider",
              embeddingProviderId: prov.id,
              modelOrEndpoint: "text-embedding-3-small",
              dimensions: 1536,
            }),
          })
        );
        if (encRes.status !== 201) return;
        const enc = await encRes.json();
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ embedding: [0.1, 0.2, 0.3] }],
            }),
        }) as typeof fetch;
        const result = await embed(enc.id, ["hello"]);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual([0.1, 0.2, 0.3]);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/embeddings"),
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer secret-key-from-env",
            }),
          })
        );
      } finally {
        if (prevEnv !== undefined) process.env.EMBED_PROVIDER_KEY = prevEnv;
        else delete process.env.EMBED_PROVIDER_KEY;
      }
    });

    it("embed with embeddingProviderId (openai) uses apiKey from extra when apiKeyRef not set", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed openai extra key",
            type: "openai",
            endpoint: "https://api.openai.com/v1",
            extra: JSON.stringify({ apiKey: "inline-extra-key" }),
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
            name: "Enc openai extra",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.5, 0.6, 0.7] }],
          }),
      }) as typeof fetch;
      const result = await embed(enc.id, ["text"]);
      expect(result[0]).toEqual([0.5, 0.6, 0.7]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer inline-extra-key",
          }),
        })
      );
    });

    it("embed with embeddingProviderId (custom_http) uses provider endpoint when set", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed custom_http with endpoint",
            type: "custom_http",
            endpoint: "https://custom-emb.example.com/v1/embeddings",
            extra: JSON.stringify({ apiKey: "custom-key" }),
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
            name: "Enc custom_http",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "model",
            dimensions: 8,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2] }],
          }),
      }) as typeof fetch;
      const result = await embed(enc.id, ["hello"]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual([0.1, 0.2]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://custom-emb.example.com/v1/embeddings",
        expect.any(Object)
      );
    });

    it("embed with embeddingProviderId throws when provider has no endpoint and type is not openai/openrouter/huggingface", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed custom no endpoint",
            type: "custom_http",
            endpoint: null,
            extra: JSON.stringify({ apiKey: "k" }),
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
            name: "Enc custom no ep",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "model",
            dimensions: 8,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      await expect(embed(enc.id, ["x"])).rejects.toThrow("No endpoint for embedding provider");
    });

    it("embed via provider with type custom_http and endpoint null hits empty endpoint branch", async () => {
      const provId = "prov-no-ep-" + Date.now();
      const encId = "enc-no-ep-" + Date.now();
      await db
        .insert(ragEmbeddingProviders)
        .values({
          id: provId,
          name: "No endpoint provider",
          type: "custom_http",
          endpoint: null,
          apiKeyRef: null,
          extra: JSON.stringify({ apiKey: "k" }),
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(ragEncodingConfigs)
        .values({
          id: encId,
          name: "Enc no ep direct",
          provider: "openai",
          modelOrEndpoint: "m",
          dimensions: 8,
          embeddingProviderId: provId,
          createdAt: Date.now(),
        })
        .run();
      try {
        await expect(embed(encId, ["x"])).rejects.toThrow("No endpoint for embedding provider");
      } finally {
        await db.delete(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, encId)).run();
        await db.delete(ragEmbeddingProviders).where(eq(ragEmbeddingProviders.id, provId)).run();
      }
    });

    it("embed with embeddingProviderId (openai) throws when no API key", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed openai no key",
            type: "openai",
            endpoint: "https://api.openai.com/v1",
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
            name: "Enc openai nokey",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      await expect(embed(enc.id, ["x"])).rejects.toThrow(
        "No API key configured for embedding provider"
      );
    });

    it("embed with embeddingProviderId (local) throws when response not ok", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed local fail",
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
            name: "Enc local fail",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "nomic-embed-text",
            dimensions: 768,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      }) as typeof fetch;
      await expect(embed(enc.id, ["x"])).rejects.toThrow("Ollama embedding error (500)");
    });

    it("embed with embeddingProviderId (local) throws when vector count mismatch", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed local count",
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
            name: "Enc local count",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "nomic-embed-text",
            dimensions: 768,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            embeddings: [[0.1, 0.2]],
          }),
      }) as typeof fetch;
      await expect(embed(enc.id, ["a", "b"])).rejects.toThrow("returned 1 vectors for 2 inputs");
    });

    it("embed with embeddingProviderId (openai) throws when API returns non-ok", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed openai err",
            type: "openai",
            endpoint: "https://api.openai.com/v1",
            extra: JSON.stringify({ apiKey: "k" }),
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
            name: "Enc openai err",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("Rate limited"),
      }) as typeof fetch;
      await expect(embed(enc.id, ["x"])).rejects.toThrow("Embedding API error (429)");
    });

    it("embed with embeddingProviderId (openai) throws when API returns wrong vector count", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed openai count",
            type: "openai",
            endpoint: "https://api.openai.com/v1",
            extra: JSON.stringify({ apiKey: "k" }),
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
            name: "Enc openai count",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1] }],
          }),
      }) as typeof fetch;
      await expect(embed(enc.id, ["a", "b"])).rejects.toThrow("returned 1 vectors for 2 inputs");
    });

    it("embed with embeddingProviderId skips invalid extra JSON (no apiKey from extra)", async () => {
      const provId = "prov-bad-extra-" + Date.now();
      await db
        .insert(ragEmbeddingProviders)
        .values({
          id: provId,
          name: "Embed bad extra",
          type: "openai",
          endpoint: "https://api.openai.com/v1",
          apiKeyRef: null,
          extra: "not valid json",
          createdAt: Date.now(),
        })
        .run();
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc bad extra",
            embeddingProviderId: provId,
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      await expect(embed(enc.id, ["x"])).rejects.toThrow("No API key configured");
      await db.delete(ragEmbeddingProviders).where(eq(ragEmbeddingProviders.id, provId)).run();
    });

    it("embed with embeddingProviderId (local) throws when endpoint becomes empty", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed local empty ep",
            type: "local",
            endpoint: "/",
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
            name: "Enc local empty",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "nomic-embed-text",
            dimensions: 768,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      await expect(embed(enc.id, ["x"])).rejects.toThrow(
        "No endpoint for local embedding provider"
      );
    });

    it("legacy path with provider openrouter uses openrouter endpoint", async () => {
      const listRes = await llmListGet();
      const list = await listRes.json();
      const hasOpenRouter =
        Array.isArray(list) && list.some((c: { provider: string }) => c.provider === "openrouter");
      if (!hasOpenRouter) {
        process.env.EMBED_OPENROUTER_KEY = "openrouter-key";
        await llmPost(
          new Request("http://localhost/api/llm/providers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "openrouter",
              model: "gpt-4o-mini",
              endpoint: "https://openrouter.ai/api/v1",
              apiKeyRef: "EMBED_OPENROUTER_KEY",
            }),
          })
        );
      }
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc openrouter legacy",
            provider: "openrouter",
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
      }) as typeof fetch;
      const result = await embed(enc.id, ["hello"]);
      expect(result).toHaveLength(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/openrouter\.ai.*\/embeddings/),
        expect.any(Object)
      );
    });

    it("legacy path with config.endpoint uses that endpoint", async () => {
      process.env.EMBED_CUSTOM_KEY = "custom-key";
      await llmPost(
        new Request("http://localhost/api/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "custom_embed",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKeyRef: "EMBED_CUSTOM_KEY",
          }),
        })
      );
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc custom endpoint",
            provider: "custom_embed",
            modelOrEndpoint: "my-model",
            dimensions: 256,
            endpoint: "https://custom-embed.example.com/v1",
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.5, 0.6] }],
          }),
      }) as typeof fetch;
      await embed(enc.id, ["x"]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://custom-embed.example.com/v1/embeddings",
        expect.any(Object)
      );
    });

    it("legacy path with modelOrEndpoint without http sends model name in body", async () => {
      process.env.EMBED_MODEL_KEY = "model-key";
      await llmPost(
        new Request("http://localhost/api/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "embed_model_provider",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKeyRef: "EMBED_MODEL_KEY",
          }),
        })
      );
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc model name",
            provider: "embed_model_provider",
            modelOrEndpoint: "text-embedding-ada-002",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2] }],
          }),
      }) as typeof fetch;
      await embed(enc.id, ["x"]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"model":"text-embedding-ada-002"'),
        })
      );
    });

    it("embed with embeddingProviderId (openrouter) uses default endpoint when endpoint not set", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed openrouter default",
            type: "openrouter",
            endpoint: null,
            extra: JSON.stringify({ apiKey: "openrouter-k" }),
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
            name: "Enc openrouter default",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 1536,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2] }],
          }),
      }) as typeof fetch;
      await embed(enc.id, ["x"]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/openrouter\.ai\/api\/v1\/embeddings/),
        expect.any(Object)
      );
    });

    it("embed with embeddingProviderId (huggingface) uses default endpoint when endpoint not set", async () => {
      const provRes = await provPost(
        new Request("http://localhost/api/rag/embedding-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Embed hf default",
            type: "huggingface",
            endpoint: null,
            extra: JSON.stringify({ apiKey: "hf-k" }),
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
            name: "Enc hf default",
            embeddingProviderId: prov.id,
            modelOrEndpoint: "model",
            dimensions: 384,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.2, 0.3] }],
          }),
      }) as typeof fetch;
      await embed(enc.id, ["y"]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/api-inference\.huggingface\.co\/embeddings/),
        expect.any(Object)
      );
    });

    it("legacy path with modelOrEndpoint containing http uses it as endpoint", async () => {
      process.env.EMBED_HTTP_KEY = "http-key";
      await llmPost(
        new Request("http://localhost/api/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "http_embed",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKeyRef: "EMBED_HTTP_KEY",
          }),
        })
      );
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc http endpoint",
            provider: "http_embed",
            modelOrEndpoint: "https://embed-http.example.com/v1/embeddings",
            dimensions: 128,
          }),
        })
      );
      if (encRes.status !== 201) return;
      const enc = await encRes.json();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1] }],
          }),
      }) as typeof fetch;
      await embed(enc.id, ["y"]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://embed-http.example.com/v1/embeddings",
        expect.objectContaining({
          body: expect.stringContaining('"model":"default"'),
        })
      );
    });
  });
});
