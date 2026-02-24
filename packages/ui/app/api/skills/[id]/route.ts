import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { skills, agentSkills } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(skills).where(eq(skills.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return json({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    type: r.type,
    content: r.content ?? undefined,
    config: r.config ? (JSON.parse(r.config) as unknown) : undefined,
    createdAt: r.createdAt,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(skills).where(eq(skills.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: {
    name?: string;
    description?: string;
    type?: string;
    content?: string;
    config?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.type !== undefined) updates.type = body.type;
  if (body.content !== undefined) updates.content = body.content;
  if (body.config !== undefined)
    updates.config = body.config != null ? JSON.stringify(body.config) : null;
  if (Object.keys(updates).length > 0) {
    await db.update(skills).set(updates).where(eq(skills.id, id)).run();
  }
  const updated = await db.select().from(skills).where(eq(skills.id, id));
  const r = updated[0];
  return json({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    type: r.type,
    content: r.content ?? undefined,
    config: r.config ? (JSON.parse(r.config) as unknown) : undefined,
    createdAt: r.createdAt,
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(skills).where(eq(skills.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(agentSkills).where(eq(agentSkills.skillId, id)).run();
  await db.delete(skills).where(eq(skills.id, id)).run();
  return json({ ok: true });
}
