/**
 * Tool handlers for web search and fetch: web_search, fetch_url.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { searchWeb, fetchUrl } from "@agentron-studio/runtime";
import { getAppSettings } from "../../_lib/app-settings";

export const WEB_TOOL_NAMES = ["web_search", "fetch_url"] as const;

export async function handleWebTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "web_search": {
      const query = typeof a.query === "string" ? (a.query as string).trim() : "";
      if (!query) return { error: "query is required", results: [] };
      const maxResults =
        typeof a.maxResults === "number" && a.maxResults > 0
          ? Math.min(a.maxResults, 20)
          : undefined;
      const appSettings = getAppSettings();
      const searchOptions: Parameters<typeof searchWeb>[1] = {
        maxResults,
        provider: appSettings.webSearchProvider,
        braveApiKey: appSettings.braveSearchApiKey,
        googleCseKey: appSettings.googleCseKey,
        googleCseCx: appSettings.googleCseCx,
      };
      try {
        const out = await searchWeb(query, searchOptions);
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Web search failed", message, results: [] };
      }
    }
    case "fetch_url": {
      const url = typeof a.url === "string" ? (a.url as string).trim() : "";
      if (!url) return { error: "url is required" };
      try {
        return await fetchUrl({ url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Fetch failed", message };
      }
    }
    default:
      return undefined;
  }
}
