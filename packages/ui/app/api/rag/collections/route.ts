import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragCollections } from "@agentron-studio/core";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(ragCollections);
  return json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      scope: r.scope,
      agentId: r.agentId ?? undefined,
      encodingConfigId: r.encodingConfigId,
      documentStoreId: r.documentStoreId,
      vectorStoreId: r.vectorStoreId ?? undefined,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name: string;
    scope: "agent" | "deployment";
    agentId?: string;
    encodingConfigId: string;
    documentStoreId: string;
    vectorStoreId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(ragCollections)
    .values({
      id,
      name: body.name,
      scope: body.scope,
      agentId: body.scope === "agent" ? (body.agentId ?? null) : null,
      encodingConfigId: body.encodingConfigId,
      documentStoreId: body.documentStoreId,
      vectorStoreId: body.vectorStoreId ?? null,
      createdAt: now,
    })
    .run();
  return json(
    {
      id,
      name: body.name,
      scope: body.scope,
      agentId: body.agentId,
      encodingConfigId: body.encodingConfigId,
      documentStoreId: body.documentStoreId,
      vectorStoreId: body.vectorStoreId ?? undefined,
      createdAt: now,
    },
    { status: 201 }
  );
}
