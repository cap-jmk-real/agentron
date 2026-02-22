import { json } from "../../../../_lib/response";
import { db } from "../../../../_lib/db";
import { ragConnectors } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import {
  browseLocalPath,
  browseGoogleDrive,
  browseDropbox,
  browseOneDrive,
  browseNotion,
  browseConfluence,
  browseGitBook,
  browseBookStack,
} from "../../_lib/browse";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf"]);

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/**
 * GET — List items in a connector (browse). No download or write to store.
 * Query: limit (default 200), pageToken (opaque token for next page).
 * Returns { items: { id, name, type?, path? }[], nextPageToken? }.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const connRows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, id));
  if (connRows.length === 0) return json({ error: "Connector not found" }, { status: 404 });
  const connector = connRows[0];
  const config = connector.config ? (JSON.parse(connector.config) as Record<string, unknown>) : {};

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 500);
  const pageToken = url.searchParams.get("pageToken") ?? undefined;

  try {
    if (
      connector.type === "filesystem" ||
      connector.type === "obsidian_vault" ||
      connector.type === "logseq_graph"
    ) {
      const dirPath = config.path as string | undefined;
      if (!dirPath || typeof dirPath !== "string") {
        return json({ error: "Local path connector requires config.path" }, { status: 400 });
      }
      const result = browseLocalPath(dirPath, TEXT_EXTENSIONS, { limit, pageToken });
      return json(result);
    }

    if (connector.type === "google_drive") {
      const result = await browseGoogleDrive(config, { limit, pageToken });
      return json(result);
    }

    if (connector.type === "dropbox") {
      const result = await browseDropbox(config, { limit, pageToken });
      return json(result);
    }

    if (connector.type === "onedrive") {
      const result = await browseOneDrive(config, { limit });
      return json(result);
    }

    if (connector.type === "notion") {
      const result = await browseNotion(config, { limit });
      return json(result);
    }

    if (connector.type === "confluence") {
      const result = await browseConfluence(config, { limit });
      return json(result);
    }

    if (connector.type === "gitbook") {
      const result = await browseGitBook(config);
      return json(result);
    }

    if (connector.type === "bookstack") {
      const result = await browseBookStack(config);
      return json(result);
    }

    return json(
      { error: `Browse not implemented for connector type: ${connector.type}` },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Browse failed";
    return json({ error: message }, { status: 400 });
  }
}
