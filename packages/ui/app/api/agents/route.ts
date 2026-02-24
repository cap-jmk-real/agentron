import { json } from "../_lib/response";
import { db, agents as agentsTable, toAgentRow, fromAgentRow } from "../_lib/db";
import { randomAgentName } from "../_lib/naming";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(agentsTable);
  return json(rows.map(fromAgentRow));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const id = payload.id ?? crypto.randomUUID();
  const name = payload.name && String(payload.name).trim() ? payload.name : randomAgentName();
  const agent = { ...payload, id, name };
  await db.insert(agentsTable).values(toAgentRow(agent)).run();
  return json(agent, { status: 201 });
}
