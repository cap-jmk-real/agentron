import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { skills, agentSkills } from "@agentron-studio/core";
import { eq, and, asc, inArray } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** List skills attached to this agent (with skill details), ordered by sortOrder. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const links = await db
    .select()
    .from(agentSkills)
    .where(eq(agentSkills.agentId, id))
    .orderBy(asc(agentSkills.sortOrder));
  if (links.length === 0) {
    return json([]);
  }
  const skillIds = links.map((l) => l.skillId);
  const allSkills = await db.select().from(skills).where(inArray(skills.id, skillIds));
  const byId = Object.fromEntries(allSkills.map((s) => [s.id, s]));
  const ordered = links
    .map((l) => {
      const s = byId[l.skillId];
      if (!s) return null;
      return {
        id: s.id,
        name: s.name,
        description: s.description ?? undefined,
        type: s.type,
        content: s.content ?? undefined,
        config: s.config ? (JSON.parse(s.config) as unknown) : undefined,
        sortOrder: l.sortOrder,
        agentConfig: l.config ? (JSON.parse(l.config) as unknown) : undefined,
      };
    })
    .filter(Boolean);
  return json(ordered);
}

/** Attach a skill to this agent. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  let body: { skillId: string; sortOrder?: number; config?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { skillId } = body;
  if (!skillId) return json({ error: "skillId required" }, { status: 400 });
  const skillRows = await db.select().from(skills).where(eq(skills.id, skillId));
  if (skillRows.length === 0) return json({ error: "Skill not found" }, { status: 404 });
  const existing = await db
    .select()
    .from(agentSkills)
    .where(and(eq(agentSkills.agentId, id), eq(agentSkills.skillId, skillId)));
  if (existing.length > 0) return json({ error: "Skill already attached" }, { status: 409 });
  const maxOrder = await db
    .select({ max: agentSkills.sortOrder })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, id));
  const sortOrder = body.sortOrder ?? (maxOrder[0]?.max ?? 0) + 1;
  const now = Date.now();
  await db
    .insert(agentSkills)
    .values({
      agentId: id,
      skillId,
      sortOrder,
      config: body.config != null ? JSON.stringify(body.config) : null,
      createdAt: now,
    })
    .run();
  const s = skillRows[0];
  return json(
    {
      id: s.id,
      name: s.name,
      description: s.description ?? undefined,
      type: s.type,
      sortOrder,
      agentConfig: body.config,
    },
    { status: 201 }
  );
}

/** Remove a skill from this agent. Body: { skillId }. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  let body: { skillId: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { skillId } = body;
  if (!skillId) return json({ error: "skillId required" }, { status: 400 });
  const result = await db
    .delete(agentSkills)
    .where(and(eq(agentSkills.agentId, id), eq(agentSkills.skillId, skillId)))
    .run();
  return json({ ok: true });
}
