import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragDocuments } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/** GET ?collectionId= — list documents for a collection */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const collectionId = searchParams.get("collectionId");
  if (!collectionId) return json({ error: "collectionId required" }, { status: 400 });
  const rows = await db.select().from(ragDocuments).where(eq(ragDocuments.collectionId, collectionId));
  return json(
    rows.map((r) => ({
      id: r.id,
      collectionId: r.collectionId,
      storePath: r.storePath,
      mimeType: r.mimeType ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.createdAt,
    }))
  );
}
