import path from "node:path";
import fs from "node:fs";
import { putObject } from "../../../_lib/s3";
import { getRagUploadsDir } from "../../../_lib/db";
import { ragDocuments } from "@agentron-studio/core";
import { db } from "../../../_lib/db";
import { filterSyncItems } from "./sync-filter";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf"]);

type StoreRow = {
  id: string;
  type: string;
  bucket: string;
  region: string | null;
  endpoint: string | null;
  credentialsRef: string | null;
};

/**
 * Sync files from a local directory into the collection's document store.
 * Used by filesystem, obsidian_vault, and logseq_graph connectors.
 * Optional config.includeIds and config.excludePatterns filter which files are synced.
 */
export async function syncLocalPath(
  connectorId: string,
  collectionId: string,
  dirPath: string,
  store: StoreRow,
  useS3: boolean,
  sourceLabel: string,
  extensions?: Set<string>,
  config?: Record<string, unknown>
): Promise<{ synced: number; total: number }> {
  const extFilter = extensions ?? TEXT_EXTENSIONS;
  if (!dirPath || !path.isAbsolute(dirPath)) {
    throw new Error("Local path connector requires an absolute path in config.path");
  }
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const allPaths: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && extFilter.has(path.extname(e.name).toLowerCase())) allPaths.push(full);
    }
  }
  walk(dirPath);

  const items = allPaths.map((filePath) => ({
    id: filePath,
    name: path.basename(filePath),
    path: filePath,
  }));
  const filtered = config ? filterSyncItems(items, config) : items;
  const files = filtered.map((x) => x.id);

  let synced = 0;
  for (const filePath of files) {
    const name = path.basename(filePath);
    const ext = path.extname(name);
    const mimeType =
      ext === ".md" || ext === ".markdown"
        ? "text/markdown"
        : ext === ".txt"
          ? "text/plain"
          : ext === ".pdf"
            ? "application/pdf"
            : "application/octet-stream";
    const buffer = fs.readFileSync(filePath);
    const docId = crypto.randomUUID();
    const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storePath = `connectors/${connectorId}/${docId}_${sanitized}`;
    const localStorePath = `uploads/${docId}_${sanitized}`;

    if (useS3) {
      await putObject(
        {
          id: store.id,
          type: store.type,
          bucket: store.bucket,
          region: store.region,
          endpoint: store.endpoint,
          credentialsRef: store.credentialsRef,
        },
        storePath,
        buffer,
        mimeType
      );
    } else {
      const dir = path.join(getRagUploadsDir(), collectionId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fileName = localStorePath.replace(/^uploads\//, "");
      fs.writeFileSync(path.join(dir, fileName), buffer);
    }

    const now = Date.now();
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId,
        externalId: filePath,
        storePath: useS3 ? storePath : localStorePath,
        mimeType,
        metadata: JSON.stringify({ source: sourceLabel, name }),
        createdAt: now,
      })
      .run();
    synced++;
  }
  return { synced, total: files.length };
}
