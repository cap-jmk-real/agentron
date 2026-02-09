import { json } from "../_lib/response";
import { db, tools as toolsTable, toToolRow, fromToolRow, ensureStandardTools } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  await ensureStandardTools();
  const rows = await db.select().from(toolsTable);
  return json(rows.map(fromToolRow));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const id = payload.id ?? crypto.randomUUID();
  const tool = { ...payload, id };
  await db.insert(toolsTable).values(toToolRow(tool)).run();
  return json(tool, { status: 201 });
}
