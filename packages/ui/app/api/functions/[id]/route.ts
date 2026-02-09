import { json } from "../../_lib/response";
import { db, customFunctions, toCustomFunctionRow, fromCustomFunctionRow, tools } from "../../_lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function GET(_: Request, { params }: Params) {
  const rows = await db.select().from(customFunctions).where(eq(customFunctions.id, params.id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  return json(fromCustomFunctionRow(rows[0]));
}

export async function PUT(request: Request, { params }: Params) {
  const payload = await request.json();
  const fn = { ...payload, id: params.id };
  await db.update(customFunctions).set(toCustomFunctionRow(fn)).where(eq(customFunctions.id, params.id)).run();
  return json(fn);
}

export async function DELETE(_: Request, { params }: Params) {
  await db.delete(customFunctions).where(eq(customFunctions.id, params.id)).run();
  // Also remove the auto-registered tool
  await db.delete(tools).where(eq(tools.id, `fn-${params.id}`)).run();
  return json({ ok: true });
}
