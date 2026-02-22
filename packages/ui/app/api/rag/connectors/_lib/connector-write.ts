/**
 * Read and update connector items. Used by connector_read_item and connector_update_item tools.
 * Local path connectors (filesystem, obsidian_vault, logseq_graph): read/write file by path.
 * Cloud connectors: not implemented here yet; return clear error.
 */
import path from "node:path";
import fs from "node:fs";
import { db } from "../../../_lib/db";
import { ragConnectors } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

const LOCAL_PATH_TYPES = new Set(["filesystem", "obsidian_vault", "logseq_graph"]);

export async function readConnectorItem(
  connectorId: string,
  itemId: string
): Promise<{ content: string; mimeType?: string } | { error: string }> {
  const rows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, connectorId));
  if (rows.length === 0) return { error: "Connector not found" };
  const connector = rows[0];
  const config = connector.config ? (JSON.parse(connector.config) as Record<string, unknown>) : {};

  if (LOCAL_PATH_TYPES.has(connector.type)) {
    const dirPath = config.path as string | undefined;
    if (!dirPath || !path.isAbsolute(dirPath)) {
      return { error: "Connector has no valid config.path" };
    }
    const resolved = path.resolve(itemId);
    if (!resolved.startsWith(path.resolve(dirPath))) {
      return { error: "Item path is outside connector root" };
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { error: "Item not found or not a file" };
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeType =
      ext === ".md" || ext === ".markdown"
        ? "text/markdown"
        : ext === ".txt"
          ? "text/plain"
          : "application/octet-stream";
    const content = fs.readFileSync(resolved, "utf-8");
    return { content, mimeType };
  }

  return { error: `Read not implemented for connector type: ${connector.type}` };
}

export async function updateConnectorItem(
  connectorId: string,
  itemId: string,
  content: string
): Promise<{ ok: boolean } | { error: string }> {
  const rows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, connectorId));
  if (rows.length === 0) return { error: "Connector not found" };
  const connector = rows[0];
  const config = connector.config ? (JSON.parse(connector.config) as Record<string, unknown>) : {};

  if (LOCAL_PATH_TYPES.has(connector.type)) {
    const dirPath = config.path as string | undefined;
    if (!dirPath || !path.isAbsolute(dirPath)) {
      return { error: "Connector has no valid config.path" };
    }
    const resolved = path.resolve(itemId);
    if (!resolved.startsWith(path.resolve(dirPath))) {
      return { error: "Item path is outside connector root" };
    }
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, "utf-8");
    return { ok: true };
  }

  return { error: `Update not implemented for connector type: ${connector.type}` };
}
