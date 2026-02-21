/**
 * E2E: Web search uses app settings — PATCH webSearchProvider duckduckgo, web_search returns results (no key needed).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { GET as settingsGet, PATCH as settingsPatch } from "../../app/api/settings/app/route";
import { e2eLog } from "./e2e-logger";

describe("e2e web-search-settings", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("web-search-settings");
    e2eLog.scenario("web-search-settings", "PATCH provider duckduckgo → web_search has results");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("PATCH webSearchProvider duckduckgo then web_search returns results array", async () => {
    const getRes = await settingsGet();
    expect(getRes.status).toBe(200);
    const before = await getRes.json();

    const patchRes = await settingsPatch(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearchProvider: "duckduckgo" }),
      })
    );
    expect(patchRes.status).toBe(200);
    e2eLog.step("PATCH webSearchProvider duckduckgo", {});

    const searchRes = await executeTool("web_search", { query: "agentron" }, undefined);
    expect(searchRes).not.toEqual(expect.objectContaining({ error: "query is required" }));
    const out = searchRes as { results?: unknown[]; error?: string };
    expect(Array.isArray(out.results)).toBe(true);
    e2eLog.toolCall("web_search", `results: ${out.results?.length ?? 0}`);

    if (before.webSearchProvider !== "duckduckgo") {
      await settingsPatch(
        new Request("http://localhost/api/settings/app", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ webSearchProvider: before.webSearchProvider }),
        })
      );
    }
  });
});
