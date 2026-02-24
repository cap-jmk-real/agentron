import { json } from "../../_lib/response";
import { db, getRagUploadsDir } from "../../_lib/db";
import { ragDocuments, ragCollections, ragVectors, ragDocumentStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { embed } from "../../_lib/embeddings";
import { getObject } from "../../_lib/s3";
import { extractText } from "../../_lib/rag-extract";

export const runtime = "nodejs";
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
 * Ingest one document: chunk, embed, store vectors. Used by POST (single or bulk by collectionId).
 */
export async function ingestOneDocument(documentId: string): Promise<{ chunks: number }> {
  const docRows = await db.select().from(ragDocuments).where(eq(ragDocuments.id, documentId));
  if (docRows.length === 0) throw new Error("Document not found");
  const doc = docRows[0];
  const collectionId = doc.collectionId;

  const collRows = await db
    .select()
    .from(ragCollections)
    .where(eq(ragCollections.id, collectionId));
  if (collRows.length === 0) throw new Error("Collection not found");
  const collection = collRows[0];
  const encodingConfigId = collection.encodingConfigId;

  const storeRows = await db
    .select()
    .from(ragDocumentStores)
    .where(eq(ragDocumentStores.id, collection.documentStoreId));
  const store = storeRows[0];
  const useS3 = store && (store.type === "s3" || store.type === "minio");

  let buffer: Buffer;
  if (useS3) {
    try {
      buffer = await getObject(
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch document from bucket: ${msg}`);
    }
  } else {
    const fileName = doc.storePath.replace(/^uploads\//, "");
    const localPath = path.join(getRagUploadsDir(), collectionId, fileName);
    if (!fs.existsSync(localPath)) {
      throw new Error("Document file not found on disk. Use bundled storage or re-upload.");
    }
    buffer = fs.readFileSync(localPath);
  }
  const raw = doc.mimeType ? await extractText(buffer, doc.mimeType) : buffer.toString("utf-8");
  const chunks = chunkText(raw);
  if (chunks.length === 0) throw new Error("No text to embed");

  const embeddings = await embed(encodingConfigId, chunks);

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
  return { chunks: chunks.length };
}

/**
 * POST { documentId: string } | { collectionId: string } — Chunk, embed, store in vector table.
 * Single doc: documentId. Bulk: collectionId ingests all documents in that collection.
 */
export async function POST(request: Request) {
  let body: { documentId?: string; collectionId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.collectionId) {
    const docRows = await db
      .select({ id: ragDocuments.id })
      .from(ragDocuments)
      .where(eq(ragDocuments.collectionId, body.collectionId));
    let totalChunks = 0;
    const errors: string[] = [];
    for (const row of docRows) {
      try {
        const r = await ingestOneDocument(row.id);
        totalChunks += r.chunks;
      } catch (err) {
        errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return json({
      ok: true,
      documents: docRows.length,
      chunks: totalChunks,
      ...(errors.length > 0 ? { errors } : {}),
    });
  }
  const documentId = body.documentId;
  if (!documentId) return json({ error: "documentId or collectionId required" }, { status: 400 });
  try {
    const r = await ingestOneDocument(documentId);
    return json({ ok: true, chunks: r.chunks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Document not found") return json({ error: msg }, { status: 404 });
    if (msg === "Collection not found") return json({ error: msg }, { status: 404 });
    if (msg.includes("Document file not found")) return json({ error: msg }, { status: 404 });
    if (msg.includes("Failed to fetch document from bucket"))
      return json({ error: msg }, { status: 502 });
    return json({ error: msg }, { status: 400 });
  }
}
