import { json } from "../../_lib/response";
import { db, tools as toolsTable, toToolRow, fromToolRow } from "../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id)).limit(1);
  const row = rows[0];
  if (!row) return new Response(null, { status: 404 });
  return json(fromToolRow(row));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const payload = (await request.json()) as Record<string, unknown>;
  const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id)).limit(1);
  const existing = rows[0];
  if (!existing) return new Response(null, { status: 404 });
  const existingTool = fromToolRow(existing);
  const tool = id.startsWith("std-")
    ? {
        ...existingTool,
        id,
        inputSchema: payload.inputSchema ?? existingTool.inputSchema,
        outputSchema: payload.outputSchema ?? existingTool.outputSchema,
      }
    : ({ ...payload, id } as typeof existingTool);
  await db.update(toolsTable).set(toToolRow(tool)).where(eq(toolsTable.id, id)).run();
  return json(tool);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  if (id.startsWith("std-")) {
    return new Response(JSON.stringify({ error: "Standard tools cannot be deleted" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  await db.delete(toolsTable).where(eq(toolsTable.id, id)).run();
  return json({ ok: true });
}
