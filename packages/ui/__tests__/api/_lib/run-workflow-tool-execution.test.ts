import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  STD_IDS,
  FIRST_TURN_DEFAULT,
  buildFirstTurnPartnerMessageFromConfig,
  buildWorkflowMemoryBlock,
} from "../../../app/api/_lib/run-workflow-tool-execution";
import { getAppSettings } from "../../../app/api/_lib/app-settings";
import { searchWeb } from "@agentron-studio/runtime";

vi.mock("../../../app/api/_lib/app-settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../app/api/_lib/app-settings")>();
  return {
    ...mod,
    getAppSettings: vi.fn().mockReturnValue({
      maxFileUploadBytes: 50 * 1024 * 1024,
      containerEngine: "podman",
      shellCommandAllowlist: [],
      workflowMaxSelfFixRetries: 3,
      webSearchProvider: "duckduckgo",
      braveSearchApiKey: undefined,
      googleCseKey: undefined,
      googleCseCx: undefined,
    }),
  };
});

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@agentron-studio/runtime")>();
  return {
    ...mod,
    searchWeb: vi
      .fn()
      .mockResolvedValue({ results: [{ title: "T", url: "https://u", snippet: "S" }] }),
  };
});

describe("run-workflow-tool-execution std-web-search", () => {
  const stdWebSearch = STD_IDS["std-web-search"];

  beforeEach(() => {
    vi.mocked(searchWeb).mockClear();
    vi.mocked(getAppSettings).mockReturnValue({
      maxFileUploadBytes: 50 * 1024 * 1024,
      containerEngine: "podman",
      shellCommandAllowlist: [],
      workflowMaxSelfFixRetries: 3,
      webSearchProvider: "duckduckgo",
      braveSearchApiKey: undefined,
      googleCseKey: undefined,
      googleCseCx: undefined,
    });
  });

  it("returns error when input is null", async () => {
    const result = await stdWebSearch(null);
    expect(result).toEqual({ error: "Input must be an object with query", results: [] });
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("returns error when input is not an object", async () => {
    const result = await stdWebSearch("string");
    expect(result).toEqual({ error: "Input must be an object with query", results: [] });
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("returns error when query is missing", async () => {
    const result = await stdWebSearch({});
    expect(result).toEqual({ error: "query is required", results: [] });
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("returns error when query is empty string", async () => {
    const result = await stdWebSearch({ query: "   " });
    expect(result).toEqual({ error: "query is required", results: [] });
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("calls searchWeb with query and app settings and returns result", async () => {
    const result = await stdWebSearch({ query: "hello" });
    expect(searchWeb).toHaveBeenCalledWith("hello", {
      maxResults: undefined,
      provider: "duckduckgo",
      braveApiKey: undefined,
      googleCseKey: undefined,
      googleCseCx: undefined,
    });
    expect(result).toEqual({
      results: [{ title: "T", url: "https://u", snippet: "S" }],
    });
  });

  it("passes maxResults from input (capped at 20)", async () => {
    await stdWebSearch({ query: "q", maxResults: 10 });
    expect(searchWeb).toHaveBeenCalledWith("q", expect.objectContaining({ maxResults: 10 }));
    vi.mocked(searchWeb).mockClear();
    await stdWebSearch({ query: "q", maxResults: 50 });
    expect(searchWeb).toHaveBeenCalledWith("q", expect.objectContaining({ maxResults: 20 }));
  });

  it("passes provider and keys from getAppSettings", async () => {
    vi.mocked(getAppSettings).mockReturnValue({
      webSearchProvider: "brave",
      braveSearchApiKey: "brave-key",
      googleCseKey: undefined,
      googleCseCx: undefined,
    } as ReturnType<typeof getAppSettings>);
    await stdWebSearch({ query: "q" });
    expect(searchWeb).toHaveBeenCalledWith("q", {
      maxResults: undefined,
      provider: "brave",
      braveApiKey: "brave-key",
      googleCseKey: undefined,
      googleCseCx: undefined,
    });
  });

  it("returns error object when searchWeb throws", async () => {
    vi.mocked(searchWeb).mockRejectedValueOnce(new Error("Network error"));
    const result = await stdWebSearch({ query: "q" });
    expect(result).toEqual({
      error: "Web search failed",
      message: "Network error",
      results: [],
    });
  });

  it("returns error object when searchWeb throws non-Error", async () => {
    vi.mocked(searchWeb).mockRejectedValueOnce("plain string error");
    const result = await stdWebSearch({ query: "q" });
    expect(result).toEqual({
      error: "Web search failed",
      message: "plain string error",
      results: [],
    });
  });
});

describe("buildFirstTurnPartnerMessageFromConfig", () => {
  it("returns FIRST_TURN_DEFAULT when config is undefined or empty", () => {
    expect(buildFirstTurnPartnerMessageFromConfig(undefined)).toBe(FIRST_TURN_DEFAULT);
    expect(buildFirstTurnPartnerMessageFromConfig({})).toBe(FIRST_TURN_DEFAULT);
    expect(buildFirstTurnPartnerMessageFromConfig({ agentId: "id" })).toBe(FIRST_TURN_DEFAULT);
  });

  it("injects url when config.url is set", () => {
    const out = buildFirstTurnPartnerMessageFromConfig({
      agentId: "agent-uuid",
      url: "https://example.com",
    });
    expect(out).not.toBe(FIRST_TURN_DEFAULT);
    expect(out).toContain("https://example.com");
    expect(out).toContain("do not ask the user for it");
  });

  it("injects savedSearchUrl and autoUseVault when set", () => {
    const out = buildFirstTurnPartnerMessageFromConfig({
      savedSearchUrl: "https://search.example.com",
      autoUseVault: true,
    });
    expect(out).toContain("https://search.example.com");
    expect(out).toContain("autoUseVault is enabled");
  });

  it("injects other non-reserved params as workflow parameters", () => {
    const out = buildFirstTurnPartnerMessageFromConfig({
      agentId: "id",
      url: "https://example.com",
      query: "test query",
      limit: 10,
    });
    expect(out).toContain("https://example.com");
    expect(out).toContain("Parameters provided by the workflow");
    expect(out).toContain("query:");
    expect(out).toContain("limit:");
    expect(out).not.toMatch(/\bagentId\b/);
  });

  it("adds targetUrl hint and few-shot example when config.targetUrl is set", () => {
    const out = buildFirstTurnPartnerMessageFromConfig({
      targetUrl: "http://127.0.0.1:18200",
      targetSandboxId: "sandbox-uuid",
    });
    expect(out).toContain(
      "For every HTTP request (std-fetch-url, std-http-request), use the targetUrl value below as the url"
    );
    expect(out).toContain('Do not use "http://target"');
    expect(out).toContain("http://127.0.0.1:18200");
    expect(out).toContain("sandbox-uuid");
  });
});

describe("buildWorkflowMemoryBlock", () => {
  it("returns minimal prompt when no context and empty partner message (e.g. noSharedOutput)", () => {
    const out = buildWorkflowMemoryBlock({
      summary: "",
      recentTurns: [],
      partnerMessage: "",
    });
    expect(out).toBe("Execute your task.");
  });

  it("includes recent turns and partner message when provided", () => {
    const out = buildWorkflowMemoryBlock({
      summary: "",
      recentTurns: [{ speaker: "A", text: "hello" }],
      partnerMessage: "reply",
      precedingAgentName: "Agent B",
    });
    expect(out).toContain("Recent turns:");
    expect(out).toContain("A: hello");
    expect(out).toContain("Output from Agent B:");
    expect(out).toContain("reply");
  });
});
