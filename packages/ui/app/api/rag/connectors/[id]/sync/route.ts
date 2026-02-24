import { json } from "../../../../_lib/response";
import { db, getRagUploadsDir } from "../../../../_lib/db";
import {
  ragConnectors,
  ragCollections,
  ragDocumentStores,
  ragDocuments,
} from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { google } from "googleapis";
import { putObject } from "../../../../_lib/s3";
import { syncLocalPath } from "../../_lib/sync-local-path";
import {
  syncDropbox,
  syncOneDrive,
  syncNotion,
  syncConfluence,
  syncGitBook,
  syncBookStack,
} from "../../_lib/sync-cloud";
import { filterSyncItems } from "../../_lib/sync-filter";
import { ingestOneDocument } from "../../../ingest/route";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/**
 * POST — Run sync for a connector. For google_drive: list files in folder, download, store in collection's document store, register in rag_documents.
 */
export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const connRows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, id));
  if (connRows.length === 0) return json({ error: "Connector not found" }, { status: 404 });
  const connector = connRows[0];
  const config = connector.config ? (JSON.parse(connector.config) as Record<string, unknown>) : {};
  const collectionId = connector.collectionId;

  async function setConnectorError(errorMessage: string) {
    await db
      .update(ragConnectors)
      .set({
        status: "error",
        lastSyncAt: Date.now(),
        config: JSON.stringify({ ...config, lastError: errorMessage }),
      })
      .where(eq(ragConnectors.id, id))
      .run();
  }

  async function maybeIngestAfterSync() {
    if (config.ingestAfterSync !== true) return;
    const docRows = await db
      .select({ id: ragDocuments.id })
      .from(ragDocuments)
      .where(eq(ragDocuments.collectionId, collectionId));
    for (const row of docRows) {
      try {
        await ingestOneDocument(row.id);
      } catch {
        // ignore per-doc ingest errors
      }
    }
  }

  const collRows = await db
    .select()
    .from(ragCollections)
    .where(eq(ragCollections.id, collectionId));
  if (collRows.length === 0) return json({ error: "Collection not found" }, { status: 404 });
  const collection = collRows[0];
  const storeRows = await db
    .select()
    .from(ragDocumentStores)
    .where(eq(ragDocumentStores.id, collection.documentStoreId));
  const store = storeRows[0];
  if (!store) {
    return json({ error: "Document store not found" }, { status: 404 });
  }
  const useS3 = store.type === "s3" || store.type === "minio";

  if (connector.type === "google_drive") {
    const folderId = (config.folderId as string) || "root";
    const serviceAccountKeyRef = config.serviceAccountKeyRef as string | undefined;
    if (!serviceAccountKeyRef || !process.env[serviceAccountKeyRef]) {
      await setConnectorError(
        "Google Drive sync requires serviceAccountKeyRef pointing to an env var with the service account JSON key."
      );
      return json(
        {
          error:
            "Google Drive sync requires serviceAccountKeyRef pointing to an env var with the service account JSON key.",
        },
        { status: 400 }
      );
    }
    let credentials: unknown;
    try {
      credentials = JSON.parse(process.env[serviceAccountKeyRef]!);
    } catch {
      await setConnectorError("Invalid service account JSON in env var.");
      return json({ error: "Invalid service account JSON in env var." }, { status: 400 });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: credentials as Record<string, unknown>,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const drive = google.drive({ version: "v3", auth });
    const q =
      folderId === "root"
        ? "'root' in parents and trashed = false"
        : `'${folderId}' in parents and trashed = false`;
    const listRes = await drive.files.list({
      q,
      pageSize: 50,
      fields: "nextPageToken, files(id, name, mimeType)",
    });
    const allFiles = (listRes.data.files || []).filter(
      (f): f is { id: string; name: string; mimeType?: string } => !!f.id && !!f.name
    );
    const files = filterSyncItems(allFiles, config);
    let synced = 0;
    const mimeToExt: Record<string, string> = {
      "text/plain": ".txt",
      "text/markdown": ".md",
      "application/pdf": ".pdf",
    };

    for (const file of files) {
      if (!file.id || !file.name) continue;
      const mimeType = file.mimeType || "application/octet-stream";
      try {
        const res = await drive.files.get(
          { fileId: file.id, alt: "media" },
          { responseType: "arraybuffer" }
        );
        const buffer = Buffer.from(res.data as ArrayBuffer);
        const ext = mimeToExt[mimeType] || "";
        const storePath = `connectors/${connector.id}/${file.id}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}${ext}`;

        const docId = crypto.randomUUID();
        const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const localStorePath = `uploads/${docId}_${sanitized}${ext}`;

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
            externalId: file.id,
            storePath: useS3 ? storePath : localStorePath,
            mimeType,
            metadata: JSON.stringify({ source: "google_drive", name: file.name }),
            createdAt: now,
          })
          .run();
        synced++;
      } catch (err) {
        // skip file on error, continue
      }
    }

    await db
      .update(ragConnectors)
      .set({ status: "synced", lastSyncAt: Date.now() })
      .where(eq(ragConnectors.id, id))
      .run();
    await maybeIngestAfterSync();
    return json({ ok: true, synced, total: files.length });
  }

  if (
    connector.type === "filesystem" ||
    connector.type === "obsidian_vault" ||
    connector.type === "logseq_graph"
  ) {
    const dirPath = config.path as string | undefined;
    if (!dirPath || typeof dirPath !== "string") {
      await setConnectorError(
        "Local path connector requires config.path (absolute directory path)."
      );
      return json(
        { error: "Local path connector requires config.path (absolute directory path)." },
        { status: 400 }
      );
    }
    try {
      const sourceLabel =
        connector.type === "filesystem"
          ? "filesystem"
          : connector.type === "obsidian_vault"
            ? "obsidian"
            : "logseq";
      const result = await syncLocalPath(
        id,
        collectionId,
        dirPath,
        store,
        !!useS3,
        sourceLabel,
        undefined,
        config
      );
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Local path sync failed";
      await setConnectorError(msg);
      return json({ error: msg }, { status: 400 });
    }
  }

  if (connector.type === "dropbox") {
    try {
      const result = await syncDropbox(config, id, collectionId, store, !!useS3);
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Dropbox sync failed";
      await setConnectorError(msg);
      return json({ error: msg }, { status: 400 });
    }
  }

  if (connector.type === "onedrive") {
    try {
      const result = await syncOneDrive(config, id, collectionId, store, !!useS3);
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OneDrive sync failed";
      await setConnectorError(msg);
      return json({ error: msg }, { status: 400 });
    }
  }

  if (connector.type === "notion") {
    try {
      const result = await syncNotion(config, id, collectionId, store, !!useS3);
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Notion sync failed";
      await setConnectorError(msg);
      return json({ error: msg }, { status: 400 });
    }
  }

  if (connector.type === "confluence") {
    try {
      const result = await syncConfluence(config, id, collectionId, store, !!useS3);
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Confluence sync failed";
      await setConnectorError(msg);
      return json({ error: msg }, { status: 400 });
    }
  }

  if (connector.type === "gitbook") {
    try {
      const result = await syncGitBook(config, id, collectionId, store, !!useS3);
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      await db
        .update(ragConnectors)
        .set({ status: "error", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      return json(
        { error: err instanceof Error ? err.message : "GitBook sync failed" },
        { status: 400 }
      );
    }
  }

  if (connector.type === "bookstack") {
    try {
      const result = await syncBookStack(config, id, collectionId, store, !!useS3);
      await db
        .update(ragConnectors)
        .set({ status: "synced", lastSyncAt: Date.now() })
        .where(eq(ragConnectors.id, id))
        .run();
      await maybeIngestAfterSync();
      return json({ ok: true, synced: result.synced, total: result.total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "BookStack sync failed";
      await setConnectorError(msg);
      return json({ error: msg }, { status: 400 });
    }
  }

  await setConnectorError(`Sync not implemented for connector type: ${connector.type}`);
  return json(
    { error: `Sync not implemented for connector type: ${connector.type}` },
    { status: 400 }
  );
}
