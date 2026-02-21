import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { ragConnectors } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return json({
    id: r.id,
    type: r.type,
    collectionId: r.collectionId,
    config: r.config ? JSON.parse(r.config) : {},
    status: r.status,
    lastSyncAt: r.lastSyncAt ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: {
    type?: string;
    collectionId?: string;
    config?: Record<string, unknown>;
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.type !== undefined) updates.type = body.type;
  if (body.collectionId !== undefined) updates.collectionId = body.collectionId;
  if (body.config !== undefined) updates.config = JSON.stringify(body.config);
  if (body.status !== undefined) updates.status = body.status;
  if (Object.keys(updates).length > 0) {
    await db.update(ragConnectors).set(updates).where(eq(ragConnectors.id, id)).run();
  }
  const updated = await db.select().from(ragConnectors).where(eq(ragConnectors.id, id));
  const r = updated[0];
  return json({
    id: r.id,
    type: r.type,
    collectionId: r.collectionId,
    config: r.config ? JSON.parse(r.config) : {},
    status: r.status,
    lastSyncAt: r.lastSyncAt ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragConnectors).where(eq(ragConnectors.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(ragConnectors).where(eq(ragConnectors.id, id)).run();
  return json({ ok: true });
}
