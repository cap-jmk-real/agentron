import { json } from "../../../_lib/response";
import { db, conversations, chatMessages, fromConversationRow } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(conversations).where(eq(conversations.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  return json(fromConversationRow(rows[0]));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(conversations).where(eq(conversations.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });

  const payload = await request.json().catch(() => ({}));
  const updates: { rating?: number | null; note?: string | null; title?: string | null } = {};
  if (payload.rating !== undefined) {
    const v = payload.rating;
    updates.rating = v === null || v === "" ? null : Number(v);
  }
  if (payload.note !== undefined) updates.note = payload.note === null || payload.note === "" ? null : String(payload.note);
  if (payload.title !== undefined) updates.title = payload.title === null || payload.title === "" ? null : String(payload.title).trim();

  if (Object.keys(updates).length === 0) return json(fromConversationRow(rows[0]));

  await db.update(conversations).set(updates).where(eq(conversations.id, id)).run();
  const updated = await db.select().from(conversations).where(eq(conversations.id, id));
  return json(fromConversationRow(updated[0]));
}

/** Delete a conversation and all its messages. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(conversations).where(eq(conversations.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(chatMessages).where(eq(chatMessages.conversationId, id)).run();
  await db.delete(conversations).where(eq(conversations.id, id)).run();
  return json({ ok: true, id });
}
