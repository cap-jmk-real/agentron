import type { AssistantToolDef } from "./types";

/**
 * Guardrails (§2.0.4). User defines via chat; runtime applies when agent uses fetch/browser.
 * Config: allowedDomains, deniedDomains, sanitize (strip HTML/injection), segment (wrap remote content), maxRequests.
 */
export const GUARDRAIL_TOOLS: AssistantToolDef[] = [
  {
    name: "create_guardrail",
    description: "Create a guardrail to derisk prompt injection when the agent uses the internet. Config: allowedDomains (array), deniedDomains (array), sanitize (bool), segment (bool), maxRequests (number). Scope: deployment (scopeId empty), agent, or workflow.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["deployment", "agent", "workflow"] },
        scopeId: { type: "string", description: "Agent or workflow id when scope is agent/workflow" },
        config: {
          type: "object",
          description: "allowedDomains[], deniedDomains[], sanitize, segment, maxRequests",
          properties: {
            allowedDomains: { type: "array", items: { type: "string" } },
            deniedDomains: { type: "array", items: { type: "string" } },
            sanitize: { type: "boolean" },
            segment: { type: "boolean" },
            maxRequests: { type: "number" },
          },
        },
      },
      required: ["scope", "config"],
    },
  },
  {
    name: "list_guardrails",
    description: "List guardrails, optionally filtered by scope and scopeId.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["deployment", "agent", "workflow"] },
        scopeId: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "get_guardrail",
    description: "Get a guardrail by id.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_guardrail",
    description: "Update a guardrail's config (allowedDomains, sanitize, etc.).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        config: { type: "object" },
      },
      required: ["id", "config"],
    },
  },
  {
    name: "delete_guardrail",
    description: "Remove a guardrail.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];
