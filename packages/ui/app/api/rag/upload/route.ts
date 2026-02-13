import { json } from "../../_lib/response";
import { db, getRagUploadsDir } from "../../_lib/db";
import { getMaxFileUploadBytes, formatMaxFileUploadMb } from "../../_lib/app-settings";
import { ragCollections, ragDocuments, ragDocumentStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { getDeploymentCollectionId } from "../../_lib/rag";
import { putObject } from "../../_lib/s3";

export const runtime = "nodejs";

function ensureRagUploadsDir(collectionId: string): string {
  const dir = path.join(getRagUploadsDir(), collectionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Upload a file for a RAG collection. When the collection's document store is S3 or MinIO,
 * uploads to the bucket via PutObject (credentials from store.credentialsRef env vars).
 * Otherwise files are stored under .data/rag-uploads/{collectionId}/.
 * POST formData: file (required), collectionId (optional; defaults to deployment collection).
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return json({ error: "No file provided" }, { status: 400 });
  }

  const maxBytes = getMaxFileUploadBytes();
  if (file.size > maxBytes) {
    return json({ error: `File too large (max ${formatMaxFileUploadMb(maxBytes)})` }, { status: 413 });
  }

  let collectionId = (formData.get("collectionId") as string) || (await getDeploymentCollectionId());
  if (!collectionId) {
    return json({ error: "No collection specified and no deployment collection configured" }, { status: 400 });
  }

  const collRows = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId));
  if (collRows.length === 0) {
    return json({ error: "Collection not found" }, { status: 404 });
  }
  const collection = collRows[0];
  const storeRows = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, collection.documentStoreId));
  const store = storeRows[0];

  const id = crypto.randomUUID();
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storePath = `uploads/${id}_${sanitized}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  const useS3 = store && (store.type === "s3" || store.type === "minio");
  if (useS3) {
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: `Bucket upload failed: ${msg}. Check document store credentials (credentialsRef env var).` }, { status: 502 });
    }
  } else {
    const uploadsDir = ensureRagUploadsDir(collectionId);
    const localPath = path.join(uploadsDir, `${id}_${sanitized}`);
    fs.writeFileSync(localPath, buffer);
  }

  const now = Date.now();
  await db
    .insert(ragDocuments)
    .values({
      id,
      collectionId,
      externalId: null,
      storePath,
      mimeType,
      metadata: JSON.stringify({ originalName: file.name, size: file.size }),
      createdAt: now,
    })
    .run();

  return json(
    {
      id,
      collectionId,
      storePath,
      mimeType,
      originalName: file.name,
      size: file.size,
      createdAt: now,
    },
    { status: 201 }
  );
}
