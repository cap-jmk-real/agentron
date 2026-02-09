import { json } from "../../_lib/response";
import { db, agents as agentsTable, toAgentRow, fromAgentRow } from "../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  return json(fromAgentRow(rows[0]));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const payload = await request.json();
  const existing = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  const agent = {
    ...payload,
    id,
    createdAt: existing.length ? existing[0].createdAt : payload.createdAt ?? Date.now()
  };
  await db.update(agentsTable).set(toAgentRow(agent)).where(eq(agentsTable.id, id)).run();
  const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  return json(rows.length ? fromAgentRow(rows[0]) : agent);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(agentsTable).where(eq(agentsTable.id, id)).run();
  return json({ ok: true });
}
