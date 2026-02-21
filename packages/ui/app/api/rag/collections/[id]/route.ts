import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { ragCollections } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragCollections).where(eq(ragCollections.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return json({
    id: r.id,
    name: r.name,
    scope: r.scope,
    agentId: r.agentId ?? undefined,
    encodingConfigId: r.encodingConfigId,
    documentStoreId: r.documentStoreId,
    vectorStoreId: r.vectorStoreId ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragCollections).where(eq(ragCollections.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: {
    name?: string;
    scope?: string;
    agentId?: string;
    encodingConfigId?: string;
    documentStoreId?: string;
    vectorStoreId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.scope !== undefined) updates.scope = body.scope;
  if (body.agentId !== undefined) updates.agentId = body.agentId;
  if (body.encodingConfigId !== undefined) updates.encodingConfigId = body.encodingConfigId;
  if (body.documentStoreId !== undefined) updates.documentStoreId = body.documentStoreId;
  if (body.vectorStoreId !== undefined) updates.vectorStoreId = body.vectorStoreId ?? null;
  if (Object.keys(updates).length > 0) {
    await db.update(ragCollections).set(updates).where(eq(ragCollections.id, id)).run();
  }
  const updated = await db.select().from(ragCollections).where(eq(ragCollections.id, id));
  const r = updated[0];
  return json({
    id: r.id,
    name: r.name,
    scope: r.scope,
    agentId: r.agentId ?? undefined,
    encodingConfigId: r.encodingConfigId,
    documentStoreId: r.documentStoreId,
    vectorStoreId: r.vectorStoreId ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragCollections).where(eq(ragCollections.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(ragCollections).where(eq(ragCollections.id, id)).run();
  return json({ ok: true });
}
