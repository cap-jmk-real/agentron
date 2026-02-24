import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { ragEmbeddingProviders } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

function safeProviderRow(r: typeof ragEmbeddingProviders.$inferSelect & { extra?: string | null }) {
  const extra = r.extra ? (JSON.parse(r.extra) as Record<string, unknown>) : undefined;
  const apiKeySet = !!(
    (r.apiKeyRef && typeof process !== "undefined" && process.env?.[r.apiKeyRef]) ||
    (extra && typeof (extra as { apiKey?: string }).apiKey === "string")
  );
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    endpoint: r.endpoint ?? undefined,
    apiKeySet,
    createdAt: r.createdAt,
  };
}

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(ragEmbeddingProviders)
    .where(eq(ragEmbeddingProviders.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  return json(safeProviderRow(rows[0]));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(ragEmbeddingProviders)
    .where(eq(ragEmbeddingProviders.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: {
    name?: string;
    type?: string;
    endpoint?: string | null;
    apiKeyRef?: string | null;
    extra?: Record<string, unknown> | string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.type !== undefined) updates.type = body.type.trim();
  if (body.endpoint !== undefined) updates.endpoint = body.endpoint?.trim() || null;
  if (body.apiKeyRef !== undefined) updates.apiKeyRef = body.apiKeyRef?.trim() || null;
  if (body.extra !== undefined) {
    updates.extra =
      body.extra == null
        ? null
        : typeof body.extra === "string"
          ? body.extra
          : JSON.stringify(body.extra);
  }
  if (Object.keys(updates).length > 0) {
    await db
      .update(ragEmbeddingProviders)
      .set(updates)
      .where(eq(ragEmbeddingProviders.id, id))
      .run();
  }
  const updated = await db
    .select()
    .from(ragEmbeddingProviders)
    .where(eq(ragEmbeddingProviders.id, id));
  return json(safeProviderRow(updated[0]));
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(ragEmbeddingProviders)
    .where(eq(ragEmbeddingProviders.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(ragEmbeddingProviders).where(eq(ragEmbeddingProviders.id, id)).run();
  return json({ ok: true });
}
