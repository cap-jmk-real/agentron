import type { ToolAdapter } from "../types";

type HttpToolConfig = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
};

export const httpToolAdapter: ToolAdapter = {
  protocol: "http",
  execute: async (tool, input) => {
    const config = tool.config as HttpToolConfig;
    if (!config?.url) {
      throw new Error("HTTP tool requires a url in config.");
    }

    const response = await fetch(config.url, {
      method: config.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers
      },
      body: JSON.stringify(input ?? {})
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP tool failed (${response.status}): ${errorText}`);
    }

    return response.json();
  }
};
