import type { AssistantToolDef } from "./types";

/**
 * Knowledge connector tools: list connectors, list items, read item content, update item.
 * connectorId from list_connectors or Knowledge → Connectors; itemId from list_connector_items or RAG document externalId.
 */
export const CONNECTOR_TOOLS: AssistantToolDef[] = [
  {
    name: "list_connectors",
    description:
      "List Knowledge connectors (id, type, collectionId). Use returned ids with list_connector_items, connector_read_item, connector_update_item. Call this when the user asks to sync, list, read, or update content in a connected source (Notion, Drive, etc.) so you know which connector ids exist.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_connector_items",
    description:
      "List items (files, pages) in a Knowledge connector. Use connectorId from Knowledge → Connectors. Returns id, name, type, path for each item. Use item id as itemId in connector_read_item or connector_update_item.",
    parameters: {
      type: "object",
      properties: {
        connectorId: { type: "string", description: "Connector ID from Knowledge → Connectors" },
        limit: { type: "number", description: "Max items to return (default 200, max 500)" },
        pageToken: {
          type: "string",
          description: "Opaque token for next page from previous response",
        },
      },
      required: ["connectorId"],
    },
  },
  {
    name: "connector_read_item",
    description:
      "Read raw content of one item in a connector. connectorId from Knowledge → Connectors; itemId from list_connector_items or from a RAG document's externalId.",
    parameters: {
      type: "object",
      properties: {
        connectorId: { type: "string", description: "Connector ID from Knowledge → Connectors" },
        itemId: {
          type: "string",
          description: "Item ID (e.g. file path for local, or provider id for cloud)",
        },
      },
      required: ["connectorId", "itemId"],
    },
  },
  {
    name: "connector_update_item",
    description:
      "Update one item's content in a connector. connectorId from Knowledge → Connectors; itemId from list_connector_items or RAG document externalId. Supported for local path connectors (filesystem, Obsidian, LogSeq); cloud connectors may not be implemented yet.",
    parameters: {
      type: "object",
      properties: {
        connectorId: { type: "string", description: "Connector ID from Knowledge → Connectors" },
        itemId: { type: "string", description: "Item ID to update" },
        content: { type: "string", description: "New text/markdown content" },
      },
      required: ["connectorId", "itemId", "content"],
    },
  },
  {
    name: "ingest_deployment_documents",
    description:
      "Ingest all documents in the deployment (studio) knowledge collection: chunk and embed them so chat can search over them. Call this when the user asks to ingest, index, or make their knowledge/docs searchable.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];
