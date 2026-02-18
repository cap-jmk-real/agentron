import { json } from "../../_lib/response";
import { db, agents as agentsTable, toAgentRow, fromAgentRow } from "../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Ensure definition.toolIds includes every toolId from graph tool nodes so graph and toolIds stay in sync. */
function syncToolIdsFromGraph(definition: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!definition || typeof definition !== "object") return definition;
  const graph = definition.graph;
  if (!graph || typeof graph !== "object" || !Array.isArray((graph as { nodes?: unknown[] }).nodes)) return definition;
  const nodes = (graph as { nodes: unknown[] }).nodes;
  const fromGraph = nodes
    .filter((n): n is { type?: string; parameters?: { toolId?: string } } => typeof n === "object" && n !== null && (n as { type?: string }).type === "tool")
    .map((n) => (n.parameters?.toolId as string)?.trim())
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const declared = (definition.toolIds as string[] | undefined) ?? [];
  const merged = [...new Set([...declared, ...fromGraph])];
  return { ...definition, toolIds: merged };
}

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
  const definition = syncToolIdsFromGraph(payload.definition);
  const agent = {
    ...payload,
    ...(definition != null && { definition }),
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
