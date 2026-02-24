import type { AssistantToolDef } from "./types";

export const CUSTOM_FUNCTION_TOOLS: AssistantToolDef[] = [
  {
    name: "create_code_tool",
    description:
      "Create a new tool that runs custom code (JavaScript, Python, or TypeScript). Creates the function and a native tool in one step; the tool is assigned a default runner sandbox so it can run immediately. Use when the user wants to add a capability as a code-based tool that agents can call.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name for the tool" },
        description: { type: "string", description: "What the tool does (for the LLM)" },
        language: {
          type: "string",
          enum: ["javascript", "python", "typescript"],
          description: "Runtime language",
        },
        source: {
          type: "string",
          description:
            "Source code; must define async main(input) for JS/TS or main(input) for Python, returning the result",
        },
        inputSchema: {
          type: "object",
          description: "Optional JSON Schema for tool input (properties, required)",
        },
      },
      required: ["name", "language", "source"],
    },
  },
  {
    name: "list_custom_functions",
    description:
      "List all custom code functions (id, name, language, description). Does not include source. Use before get_custom_function to find the function id when improving a code tool.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_custom_function",
    description:
      "Get full details of a custom function by id (name, description, language, source, sandboxId). Use when improving a code tool: get_tool gives config.functionId, then call this to read the current source before update_custom_function.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Custom function id" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_custom_function",
    description:
      "Update a custom function (source, name, description, or sandboxId). Use after get_custom_function to improve the code of a tool. Partial update: only provided fields are changed.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Custom function id" },
        source: { type: "string", description: "New source code" },
        name: { type: "string", description: "New display name" },
        description: { type: "string", description: "New description" },
        sandboxId: { type: "string", description: "Sandbox id to run the function in" },
      },
      required: ["id"],
    },
  },
];
