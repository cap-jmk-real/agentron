import type { AssistantToolDef } from "./types";

/**
 * Agent-implemented storage (§2.0.2). The agent can create named stores (key-value)
 * scoped to an agent or job and use them for eval sets, run metadata, technique insights, etc.
 */
export const STORE_TOOLS: AssistantToolDef[] = [
  {
    name: "create_store",
    description: "Create a named store (key-value) scoped to an agent or job. The agent uses this for its own persistence (eval sets, run metadata, etc.) without touching the app's core schema.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["agent", "job"], description: "Scope type" },
        scopeId: { type: "string", description: "Agent id or improvement job id" },
        name: { type: "string", description: "Store name (e.g. eval_set_v1)" },
      },
      required: ["scope", "scopeId", "name"],
    },
  },
  {
    name: "put_store",
    description: "Write a key-value entry into a store. Overwrites if key exists.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["agent", "job"] },
        scopeId: { type: "string" },
        storeName: { type: "string" },
        key: { type: "string" },
        value: { type: "string", description: "JSON string or plain string" },
      },
      required: ["scope", "scopeId", "storeName", "key", "value"],
    },
  },
  {
    name: "get_store",
    description: "Read a value by key from a store.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["agent", "job"] },
        scopeId: { type: "string" },
        storeName: { type: "string" },
        key: { type: "string" },
      },
      required: ["scope", "scopeId", "storeName", "key"],
    },
  },
  {
    name: "query_store",
    description: "Query entries in a store by key prefix. Returns matching key-value pairs.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["agent", "job"] },
        scopeId: { type: "string" },
        storeName: { type: "string" },
        prefix: { type: "string", description: "Key prefix to match" },
      },
      required: ["scope", "scopeId", "storeName"],
    },
  },
  {
    name: "list_stores",
    description: "List store names for a scope (agent or job).",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["agent", "job"] },
        scopeId: { type: "string" },
      },
      required: ["scope", "scopeId"],
    },
  },
  {
    name: "delete_store",
    description: "Remove a store and all its entries.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["agent", "job"] },
        scopeId: { type: "string" },
        storeName: { type: "string" },
      },
      required: ["scope", "scopeId", "storeName"],
    },
  },
];
