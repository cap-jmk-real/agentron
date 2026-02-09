import { json } from "../_lib/response";
import { db } from "../_lib/db";
import { skills } from "@agentron-studio/core";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(skills);
  return json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      type: r.type,
      content: r.content ?? undefined,
      config: r.config ? (JSON.parse(r.config) as unknown) : undefined,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name: string;
    description?: string;
    type: string;
    content?: string;
    config?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(skills)
    .values({
      id,
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      content: body.content ?? null,
      config: body.config != null ? JSON.stringify(body.config) : null,
      createdAt: now,
    })
    .run();
  return json(
    {
      id,
      name: body.name,
      description: body.description,
      type: body.type,
      content: body.content,
      config: body.config,
      createdAt: now,
    },
    { status: 201 }
  );
}
