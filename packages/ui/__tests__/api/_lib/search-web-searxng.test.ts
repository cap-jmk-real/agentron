/**
 * Unit tests for searchWeb with SearXNG provider (runtime search.ts).
 * Mocks global fetch to avoid hitting a real SearXNG instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchWeb } from "@agentron-studio/runtime";

describe("searchWeb SearXNG provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/search?q=") && u.includes("format=json")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [
                  { url: "https://a.example.com/1", title: "Title A", content: "Snippet A" },
                  { url: "https://b.example.com/2", title: "Title B", content: "Snippet B" },
                ],
              }),
          } as Response);
        }
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("Not found") } as Response);
      })
    );
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  it("returns mapped results when provider is searxng and baseUrl is set", async () => {
    const result = await searchWeb("test query", {
      provider: "searxng",
      searxngBaseUrl: "http://localhost:8888",
      maxResults: 5,
    });
    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: "Title A",
      url: "https://a.example.com/1",
      snippet: "Snippet A",
    });
    expect(result.results[1]).toEqual({
      title: "Title B",
      url: "https://b.example.com/2",
      snippet: "Snippet B",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8888/search?q=test%20query&format=json",
      expect.any(Object)
    );
  });

  it("returns error when provider is searxng but searxngBaseUrl is missing", async () => {
    const result = await searchWeb("q", { provider: "searxng" });
    expect(result.results).toEqual([]);
    expect(result.error).toContain("SearXNG base URL not set");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns error when SearXNG returns non-ok", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    } as Response);
    const result = await searchWeb("q", {
      provider: "searxng",
      searxngBaseUrl: "http://localhost:8888",
    });
    expect(result.results).toEqual([]);
    expect(result.error).toContain("403");
  });

  it("returns error when SearXNG returns invalid JSON", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error("Invalid JSON")),
    } as Response);
    const result = await searchWeb("q", {
      provider: "searxng",
      searxngBaseUrl: "http://localhost:8888",
    });
    expect(result.results).toEqual([]);
    expect(result.error).toContain("invalid JSON");
  });

  it("strips trailing slash from baseUrl", async () => {
    await searchWeb("q", {
      provider: "searxng",
      searxngBaseUrl: "http://localhost:8888/",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8888/search?q=q&format=json",
      expect.any(Object)
    );
  });

  it("slices results to maxResults", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { url: "https://1", title: "1", content: "c1" },
            { url: "https://2", title: "2", content: "c2" },
            { url: "https://3", title: "3", content: "c3" },
          ],
        }),
    } as Response);
    const result = await searchWeb("q", {
      provider: "searxng",
      searxngBaseUrl: "http://localhost:8888",
      maxResults: 2,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].url).toBe("https://1");
    expect(result.results[1].url).toBe("https://2");
  });
});
