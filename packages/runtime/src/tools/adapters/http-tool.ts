import type { ToolAdapter } from "../types";

type HttpToolConfig = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
};

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function extractPathParamNames(url: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(url)) !== null) names.push(m[1]);
  return names;
}

function substitutePathParams(url: string, input: Record<string, unknown>): string {
  let out = url;
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      out = out.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, "g"), String(value));
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, String(v));
    } else {
      search.append(key, String(value));
    }
  }
  const q = search.toString();
  return q ? `?${q}` : "";
}

export const httpToolAdapter: ToolAdapter = {
  protocol: "http",
  execute: async (tool, input) => {
    const config = tool.config as HttpToolConfig;
    if (!config?.url) {
      throw new Error("HTTP tool requires a url in config.");
    }

    const method = (config.method ?? "POST").toUpperCase();
    const rawInput = input != null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const pathParamNames = extractPathParamNames(config.url);
    const pathParams: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawInput)) {
      if (pathParamNames.includes(k)) pathParams[k] = v;
      else rest[k] = v;
    }

    const url = substitutePathParams(config.url, pathParams);
    const sendsBody = BODY_METHODS.has(method);
    let finalUrl = url;
    let body: string | undefined;

    if (sendsBody) {
      body = JSON.stringify(rest);
    } else {
      const query = buildQueryString(rest);
      finalUrl = query ? `${url}${url.includes("?") ? "&" + query.slice(1) : query}` : url;
    }

    const headers: Record<string, string> = {
      ...config.headers,
    };
    if (sendsBody && body !== undefined) {
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }

    const response = await fetch(finalUrl, {
      method,
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP tool failed (${response.status}): ${errorText}`);
    }

    const contentType = response.headers.get("content-type");
    const text = await response.text();
    if (contentType?.includes("application/json") && text) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  },
};
