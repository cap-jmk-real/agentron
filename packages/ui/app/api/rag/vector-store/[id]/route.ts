import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { ragVectorStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragVectorStores).where(eq(ragVectorStores.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return json({
    id: r.id,
    name: r.name,
    type: r.type,
    config: r.config ? JSON.parse(r.config) : undefined,
    createdAt: r.createdAt,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragVectorStores).where(eq(ragVectorStores.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: { name?: string; type?: string; config?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.config !== undefined) updates.config = JSON.stringify(body.config);
  if (Object.keys(updates).length > 0) {
    await db.update(ragVectorStores).set(updates).where(eq(ragVectorStores.id, id)).run();
  }
  const updated = await db.select().from(ragVectorStores).where(eq(ragVectorStores.id, id));
  const r = updated[0];
  return json({
    id: r.id,
    name: r.name,
    type: r.type,
    config: r.config ? JSON.parse(r.config) : undefined,
    createdAt: r.createdAt,
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragVectorStores).where(eq(ragVectorStores.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(ragVectorStores).where(eq(ragVectorStores.id, id)).run();
  return json({ ok: true });
}
