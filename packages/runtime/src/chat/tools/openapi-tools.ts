import type { AssistantToolDef } from "./types";

export const OPENAPI_TOOLS: AssistantToolDef[] = [
  {
    name: "create_tools_from_openapi",
    description:
      "Create HTTP tools from an OpenAPI/Swagger spec so they can be attached to agents. When the user provides an OpenAPI/Swagger URL or pastes a spec (JSON), call this to create one tool per API operation (path + method). Then suggest attaching the new tools to an agent via update_agent with toolIds. Use list_tools afterward so the user sees the new tool ids.",
    parameters: {
      type: "object",
      properties: {
        specUrl: {
          type: "string",
          description: "URL of the OpenAPI 3.x spec (JSON). Fetch this to get the spec.",
        },
        spec: {
          type: "object",
          description:
            "OpenAPI 3.x spec as an object (e.g. from pasted JSON). Use when the user pastes the spec instead of providing a URL.",
        },
        baseUrlOverride: {
          type: "string",
          description:
            "Override the API base URL from the spec (optional). Use when the spec's servers[0].url is wrong or missing.",
        },
      },
      required: [],
    },
  },
];
