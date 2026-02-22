import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryQdrant, queryPgvector } from "../../../app/api/_lib/vector-store-query";

describe("vector-store-query", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("queryQdrant", () => {
    it("returns chunks from successful response", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: [
              { payload: { text: "chunk one" }, score: 0.9 },
              { payload: { text: "chunk two" }, score: 0.8 },
            ],
          }),
      } as Response);

      const result = await queryQdrant("coll-1", [0.1, 0.2, 0.3], 5, {
        endpoint: "http://qdrant:6333",
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ text: "chunk one", score: 0.9 });
      expect(result[1]).toEqual({ text: "chunk two", score: 0.8 });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://qdrant:6333/collections/coll-1/points/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            vector: [0.1, 0.2, 0.3],
            limit: 5,
            with_payload: true,
            with_vector: false,
          }),
        })
      );
    });

    it("strips trailing slash from endpoint", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      } as Response);

      await queryQdrant("c", [0], 1, { endpoint: "http://localhost:6333/" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:6333/collections/c/points/search",
        expect.any(Object)
      );
    });

    it("uses default endpoint when not provided", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      } as Response);

      await queryQdrant("c", [0], 1, {});

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:6333/collections/c/points/search",
        expect.any(Object)
      );
    });

    it("returns empty array when response has no result key", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const result = await queryQdrant("c", [0], 1, {});

      expect(result).toEqual([]);
    });

    it("includes api-key header when apiKeyRef is set and env has value", async () => {
      const orig = process.env.TEST_API_KEY_REF;
      process.env.TEST_API_KEY_REF = "secret-key";
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      } as Response);

      await queryQdrant("c", [0], 1, { apiKeyRef: "TEST_API_KEY_REF" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ "api-key": "secret-key" }),
        })
      );
      if (orig !== undefined) process.env.TEST_API_KEY_REF = orig;
      else delete process.env.TEST_API_KEY_REF;
    });

    it("does not include api-key header when apiKeyRef is empty", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      } as Response);

      await queryQdrant("c", [0], 1, { apiKeyRef: "" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({ "api-key": expect.anything() }),
        })
      );
    });

    it("filters out chunks with empty text", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: [
              { payload: { text: "ok" }, score: 0.9 },
              { payload: {}, score: 0.8 },
              { payload: { text: "" }, score: 0.7 },
            ],
          }),
      } as Response);

      const result = await queryQdrant("c", [0], 5, {});

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("ok");
    });

    it("throws on non-ok response with status and body", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      } as Response);

      await expect(queryQdrant("c", [0], 1, {})).rejects.toThrow(
        "Qdrant search failed: 500 Internal Server Error"
      );
    });
  });

  describe("queryPgvector", () => {
    it("throws when connectionStringRef env is not set", async () => {
      const ref = "PG_VEC_REF_MISSING";
      const orig = process.env[ref];
      delete process.env[ref];

      await expect(queryPgvector("c", [0], 1, { connectionStringRef: ref })).rejects.toThrow(
        "connectionStringRef env var not set"
      );

      if (orig !== undefined) process.env[ref] = orig;
    });
  });
});
