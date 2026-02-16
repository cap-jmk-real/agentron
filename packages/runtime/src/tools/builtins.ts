import type { NativeToolAdapter } from "./adapters/native-tool";
import { searchWeb } from "./search";

const STD_FETCH_URL = "std-fetch-url";
const STD_BROWSER = "std-browser";
const STD_RUN_CODE = "std-run-code";
const STD_HTTP_REQUEST = "std-http-request";
const STD_WEBHOOK = "std-webhook";
const STD_WEATHER = "std-weather";
const STD_WEB_SEARCH = "std-web-search";

function getUrl(input: unknown): string | null {
  if (input === null || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const url = o.url ?? o.URL;
  return typeof url === "string" ? url : null;
}

function getBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.AGENTOS_APP_URL) {
    return process.env.AGENTOS_APP_URL.replace(/\/$/, "");
  }
  return "http://127.0.0.1:3000";
}

/**
 * Fetches a URL and returns the response body as text.
 * Input: { url: string }
 */
export async function fetchUrl(input: unknown): Promise<unknown> {
  const url = getUrl(input);
  if (!url) {
    return { error: "Missing url in input", usage: { url: "string (required)" } };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AgentOS-Tool/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    return { status: res.status, url, content: text.slice(0, 100_000) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Fetch failed", message };
  }
}

/**
 * Browser tool: fetches URL and returns content (same as fetch_url for now).
 * Input: { url: string, action?: string }
 */
export async function browser(input: unknown): Promise<unknown> {
  return fetchUrl(input);
}

/**
 * Run Code: executes JavaScript or Python. Calls the app's /api/run-code endpoint.
 * Input: { language: "javascript" | "python", code: string, input?: unknown }
 */
export async function runCode(input: unknown): Promise<unknown> {
  if (input === null || typeof input !== "object") {
    return { error: "Input must be an object with language and code" };
  }
  const o = input as Record<string, unknown>;
  const language = (o.language ?? "javascript") as string;
  const code = o.code as string;
  if (!code || typeof code !== "string") {
    return { error: "code is required" };
  }
  try {
    const baseUrl = getBaseUrl();
    const res = await fetch(`${baseUrl}/api/run-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code, input: o.input }),
      signal: AbortSignal.timeout(60000),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { error: data.error ?? "Run failed", ...data };
    }
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Run code failed", message };
  }
}

/**
 * HTTP Request: full HTTP call with method, headers, body.
 * Input: { url: string, method?: string, headers?: object, body?: object | string }
 */
export async function httpRequest(input: unknown): Promise<unknown> {
  if (input === null || typeof input !== "object") {
    return { error: "Input must be an object with url" };
  }
  const o = input as Record<string, unknown>;
  const url = getUrl(o);
  if (!url) return { error: "url is required" };
  const method = ((o.method as string) ?? "GET").toUpperCase();
  const headers = (o.headers as Record<string, string>) ?? {};
  let body: string | undefined;
  if (o.body !== undefined && o.body !== null) {
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  }
  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": "AgentOS-Tool/1.0", ...headers },
      body: body ?? undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let content: unknown = text;
    try {
      if (headers["Accept"]?.includes("json") || res.headers.get("content-type")?.includes("json")) {
        content = JSON.parse(text);
      }
    } catch {
      // keep as text
    }
    return { status: res.status, url, content, headers: Object.fromEntries(res.headers.entries()) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "HTTP request failed", message };
  }
}

/**
 * Webhook: POST JSON to a URL.
 * Input: { url: string, body?: object }
 */
export async function webhook(input: unknown): Promise<unknown> {
  if (input === null || typeof input !== "object") {
    return { error: "Input must be an object with url" };
  }
  const o = input as Record<string, unknown>;
  const url = getUrl(o);
  if (!url) return { error: "url is required" };
  const body = o.body ?? {};
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "AgentOS-Tool/1.0" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    return { status: res.status, url, response: text.slice(0, 5000) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Webhook failed", message };
  }
}

/**
 * Weather: get current weather via Open-Meteo (no API key).
 * Input: { location: string, units?: "celsius" | "fahrenheit" }
 */
export async function weather(input: unknown): Promise<unknown> {
  if (input === null || typeof input !== "object") {
    return { error: "Input must be an object with location" };
  }
  const o = input as Record<string, unknown>;
  const location = (o.location as string)?.trim();
  if (!location) return { error: "location is required (e.g. 'Berlin' or '52.52,13.41')" };
  const units = (o.units as string) === "fahrenheit" ? "fahrenheit" : "celsius";
  try {
    let lat: number;
    let lon: number;
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(location)) {
      const [a, b] = location.split(",").map((s) => parseFloat(s.trim()));
      lat = a;
      lon = b;
    } else {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
        { signal: AbortSignal.timeout(10000) }
      );
      const geo = (await geoRes.json()) as { results?: { latitude: number; longitude: number }[] };
      if (!geo?.results?.length) {
        return { error: "Location not found", location };
      }
      lat = geo.results[0].latitude;
      lon = geo.results[0].longitude;
    }
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };
    if (!data?.current) {
      return { error: "No weather data", location };
    }
    const temp = data.current.temperature_2m;
    const tempDisplay = units === "fahrenheit" && temp != null
      ? `${(temp * 9) / 5 + 32}°F`
      : temp != null
        ? `${temp}°C`
        : "—";
    return {
      location: location,
      temperature: temp,
      temperature_display: tempDisplay,
      humidity_percent: data.current.relative_humidity_2m,
      weather_code: data.current.weather_code,
      wind_speed_kmh: data.current.wind_speed_10m,
      units,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Weather failed", message };
  }
}

/**
 * Web search: query the web and return titles, URLs, and snippets.
 * Uses DuckDuckGo by default (no API key); Brave/Google when env vars are set.
 * Input: { query: string, maxResults?: number }
 */
export async function webSearch(input: unknown): Promise<unknown> {
  if (input === null || typeof input !== "object") {
    return { error: "Input must be an object with query", results: [] };
  }
  const o = input as Record<string, unknown>;
  const query = typeof o.query === "string" ? o.query.trim() : "";
  if (!query) {
    return { error: "query is required", results: [] };
  }
  const maxResults = typeof o.maxResults === "number" && o.maxResults > 0 ? Math.min(o.maxResults, 20) : undefined;
  try {
    return await searchWeb(query, { maxResults });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Web search failed", message, results: [] };
  }
}

export type BuiltinOptions = { baseUrl?: string };

/**
 * Registers built-in tool handlers (Fetch URL, Browser, Run Code, HTTP Request, Webhook) on the given native adapter.
 * Call this when setting up the tool registry for agent execution.
 * Run Code calls the app's /api/run-code; set AGENTOS_APP_URL or pass baseUrl if the app is not on localhost:3000.
 */
export function registerBuiltinHandlers(adapter: NativeToolAdapter, options?: BuiltinOptions): void {
  adapter.register(STD_FETCH_URL, fetchUrl);
  adapter.register(STD_BROWSER, browser);
  adapter.register(STD_RUN_CODE, runCode);
  adapter.register(STD_HTTP_REQUEST, httpRequest);
  adapter.register(STD_WEBHOOK, webhook);
  adapter.register(STD_WEATHER, weather);
  adapter.register(STD_WEB_SEARCH, webSearch);
}
