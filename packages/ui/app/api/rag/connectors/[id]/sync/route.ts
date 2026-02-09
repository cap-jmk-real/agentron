import { json } from "../../../../_lib/response";
import { db } from "../../../../_lib/db";
import { ragConnectors, ragCollections, ragDocumentStores, ragDocuments } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { google } from "googleapis";
import { putObject } from "../../../../_lib/s3";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

const RAG_UPLOADS_DIR = ".data/rag-uploads";

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

  const collRows = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId));
  if (collRows.length === 0) return json({ error: "Collection not found" }, { status: 404 });
  const collection = collRows[0];
  const storeRows = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, collection.documentStoreId));
  const store = storeRows[0];
  const useS3 = store && (store.type === "s3" || store.type === "minio");

  if (connector.type === "google_drive") {
    const folderId = (config.folderId as string) || "root";
    const serviceAccountKeyRef = config.serviceAccountKeyRef as string | undefined;
    if (!serviceAccountKeyRef || !process.env[serviceAccountKeyRef]) {
      await db.update(ragConnectors).set({ status: "error", lastSyncAt: Date.now() }).where(eq(ragConnectors.id, id)).run();
      return json({
        error: "Google Drive sync requires serviceAccountKeyRef pointing to an env var with the service account JSON key.",
      }, { status: 400 });
    }
    let credentials: unknown;
    try {
      credentials = JSON.parse(process.env[serviceAccountKeyRef]!);
    } catch {
      await db.update(ragConnectors).set({ status: "error", lastSyncAt: Date.now() }).where(eq(ragConnectors.id, id)).run();
      return json({ error: "Invalid service account JSON in env var." }, { status: 400 });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: credentials as Record<string, unknown>,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const drive = google.drive({ version: "v3", auth });
    const q = folderId === "root" ? "'root' in parents and trashed = false" : `'${folderId}' in parents and trashed = false`;
    const listRes = await drive.files.list({
      q,
      pageSize: 50,
      fields: "nextPageToken, files(id, name, mimeType)",
    });
    const files = listRes.data.files || [];
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
          const dir = path.join(process.cwd(), RAG_UPLOADS_DIR, collectionId);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const fileName = localStorePath.replace(/^uploads\//, "");
          fs.writeFileSync(path.join(dir, fileName), buffer);
        }

        const now = Date.now();
        await db.insert(ragDocuments).values({
          id: docId,
          collectionId,
          externalId: file.id,
          storePath: useS3 ? storePath : localStorePath,
          mimeType,
          metadata: JSON.stringify({ source: "google_drive", name: file.name }),
          createdAt: now,
        }).run();
        synced++;
      } catch (err) {
        // skip file on error, continue
      }
    }

    await db.update(ragConnectors).set({ status: "synced", lastSyncAt: Date.now() }).where(eq(ragConnectors.id, id)).run();
    return json({ ok: true, synced, total: files.length });
  }

  await db.update(ragConnectors).set({ status: "error", lastSyncAt: Date.now() }).where(eq(ragConnectors.id, id)).run();
  return json({ error: `Sync not implemented for connector type: ${connector.type}` }, { status: 400 });
}
