import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragVectorStores } from "@agentron-studio/core";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(ragVectorStores);
  return json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      config: r.config ? JSON.parse(r.config) : undefined,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name: string;
    type: "bundled" | "qdrant" | "pinecone" | "pgvector";
    config?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(ragVectorStores)
    .values({
      id,
      name: body.name,
      type: body.type,
      config: body.config ? JSON.stringify(body.config) : null,
      createdAt: now,
    })
    .run();
  return json(
    {
      id,
      name: body.name,
      type: body.type,
      config: body.config,
      createdAt: now,
    },
    { status: 201 }
  );
}
