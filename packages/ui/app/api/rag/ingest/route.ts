import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragDocuments, ragCollections, ragVectors, ragDocumentStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { embed } from "../../_lib/embeddings";
import { getObject } from "../../_lib/s3";

export const runtime = "nodejs";

const RAG_UPLOADS_DIR = ".data/rag-uploads";
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end - (end < text.length ? CHUNK_OVERLAP : 0);
  }
  return chunks.length ? chunks : [text];
}

/**
 * POST { documentId: string } — Chunk the document, embed with collection's encoding config, store in bundled vector table.
 */
export async function POST(request: Request) {
  let body: { documentId: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { documentId } = body;
  if (!documentId) return json({ error: "documentId required" }, { status: 400 });

  const docRows = await db.select().from(ragDocuments).where(eq(ragDocuments.id, documentId));
  if (docRows.length === 0) return json({ error: "Document not found" }, { status: 404 });
  const doc = docRows[0];
  const collectionId = doc.collectionId;

  const collRows = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId));
  if (collRows.length === 0) return json({ error: "Collection not found" }, { status: 404 });
  const collection = collRows[0];
  const encodingConfigId = collection.encodingConfigId;

  const storeRows = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, collection.documentStoreId));
  const store = storeRows[0];
  const useS3 = store && (store.type === "s3" || store.type === "minio");

  let raw: string;
  if (useS3) {
    try {
      const buf = await getObject(
        {
          id: store.id,
          type: store.type,
          bucket: store.bucket,
          region: store.region,
          endpoint: store.endpoint,
          credentialsRef: store.credentialsRef,
        },
        doc.storePath
      );
      raw = buf.toString("utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: `Failed to fetch document from bucket: ${msg}` }, { status: 502 });
    }
  } else {
    const fileName = doc.storePath.replace(/^uploads\//, "");
    const localPath = path.join(process.cwd(), RAG_UPLOADS_DIR, collectionId, fileName);
    if (!fs.existsSync(localPath)) {
      return json({ error: "Document file not found on disk. Use bundled storage or re-upload." }, { status: 404 });
    }
    raw = fs.readFileSync(localPath, "utf-8");
  }
  const chunks = chunkText(raw);
  if (chunks.length === 0) return json({ error: "No text to embed" }, { status: 400 });

  const embeddings = await embed(encodingConfigId, chunks);

  // Remove existing vectors for this document
  const existing = await db.select().from(ragVectors).where(eq(ragVectors.documentId, documentId));
  for (const row of existing) {
    await db.delete(ragVectors).where(eq(ragVectors.id, row.id)).run();
  }

  const now = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    await db
      .insert(ragVectors)
      .values({
        id: crypto.randomUUID(),
        collectionId,
        documentId,
        chunkIndex: i,
        text: chunks[i],
        embedding: JSON.stringify(embeddings[i]),
        createdAt: now,
      })
      .run();
  }

  return json({ ok: true, chunks: chunks.length });
}
