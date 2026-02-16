/**
 * Web search: DuckDuckGo (no key) and optional Brave/Google when keys are set.
 * Returns a uniform shape for both chat and agent tools.
 */

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

export type SearchWebOptions = {
  maxResults?: number;
  provider?: "duckduckgo" | "brave" | "google";
};

export type SearchWebResponse = {
  results: SearchResult[];
  summary?: string;
  error?: string;
};

const DEFAULT_MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 15000;

function getEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}

/**
 * DuckDuckGo Instant Answer API. No API key. Returns instant answer + related topics.
 * https://api.duckduckgo.com/?q=query&format=json
 */
async function searchDuckDuckGo(
  query: string,
  maxResults: number
): Promise<SearchWebResponse> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AgentOS-Tool/1.0" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { results: [], error: `DuckDuckGo request failed: ${res.status}` };
  }
  const data = (await res.json()) as {
    Abstract?: string;
    AbstractURL?: string;
    AbstractText?: string;
    Heading?: string;
    RelatedTopics?: Array<
      | { Text?: string; FirstURL?: string; Icon?: unknown }
      | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
    >;
  };
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  if (data.AbstractURL && data.AbstractText) {
    const u = data.AbstractURL.trim();
    if (u && !seen.has(u)) {
      seen.add(u);
      results.push({
        title: (data.Heading || "Result").trim(),
        url: u,
        snippet: (data.AbstractText || data.Abstract || "").trim().slice(0, 500),
      });
    }
  }

  if (Array.isArray(data.RelatedTopics)) {
    for (const item of data.RelatedTopics) {
      if (results.length >= maxResults) break;
      const topics = "Topics" in item && Array.isArray(item.Topics) ? item.Topics : [item];
      for (const t of topics) {
        const firstUrl = (t as { FirstURL?: string }).FirstURL;
        const text = (t as { Text?: string }).Text;
        if (firstUrl && !seen.has(firstUrl)) {
          seen.add(firstUrl);
          results.push({
            title: text ? text.slice(0, 200) : firstUrl,
            url: firstUrl,
            snippet: text ? text.slice(0, 500) : undefined,
          });
        }
      }
    }
  }

  const summary =
    data.AbstractText && results.length > 0
      ? data.AbstractText.trim().slice(0, 300)
      : undefined;
  return { results: results.slice(0, maxResults), summary };
}

/**
 * Brave Search API. Requires BRAVE_SEARCH_API_KEY. Richer SERP results.
 */
async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<SearchWebResponse> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": apiKey,
      "User-Agent": "AgentOS-Tool/1.0",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    return { results: [], error: `Brave search failed: ${res.status} ${text.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const web = data.web?.results ?? [];
  const results: SearchResult[] = web.slice(0, maxResults).map((r) => ({
    title: (r.title || r.url || "").trim(),
    url: (r.url || "").trim(),
    snippet: r.description?.trim().slice(0, 500),
  }));
  return { results };
}

/**
 * Google Custom Search JSON API. Requires GOOGLE_CSE_KEY and GOOGLE_CSE_CX. 100 free/day.
 */
async function searchGoogle(
  query: string,
  maxResults: number,
  apiKey: string,
  cx: string
): Promise<SearchWebResponse> {
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AgentOS-Tool/1.0" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    return { results: [], error: `Google search failed: ${res.status} ${text.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    items?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  const items = data.items ?? [];
  const results: SearchResult[] = items.slice(0, maxResults).map((r) => ({
    title: (r.title || r.link || "").trim(),
    url: (r.link || "").trim(),
    snippet: r.snippet?.trim().slice(0, 500),
  }));
  return { results };
}

/**
 * Shared web search. Uses DuckDuckGo when no keys are set; Brave or Google when env vars are set.
 */
export async function searchWeb(
  query: string,
  options?: SearchWebOptions
): Promise<SearchWebResponse> {
  const q = (query || "").trim();
  if (!q) {
    return { results: [], error: "query is required" };
  }
  const maxResults = Math.min(Math.max((options?.maxResults ?? DEFAULT_MAX_RESULTS) || 1, 1), 20);
  const provider = options?.provider;

  const braveKey = getEnv("BRAVE_SEARCH_API_KEY");
  const googleKey = getEnv("GOOGLE_CSE_KEY");
  const googleCx = getEnv("GOOGLE_CSE_CX");

  if (provider === "brave" && braveKey) {
    return searchBrave(q, maxResults, braveKey);
  }
  if (provider === "google" && googleKey && googleCx) {
    return searchGoogle(q, maxResults, googleKey, googleCx);
  }
  if (provider && provider !== "duckduckgo") {
    if (provider === "brave" && !braveKey) {
      return { results: [], error: "BRAVE_SEARCH_API_KEY not set" };
    }
    if (provider === "google" && (!googleKey || !googleCx)) {
      return { results: [], error: "GOOGLE_CSE_KEY and GOOGLE_CSE_CX must be set" };
    }
  }

  return searchDuckDuckGo(q, maxResults);
}
