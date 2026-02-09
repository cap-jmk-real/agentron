import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragConnectors } from "@agentron-studio/core";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(ragConnectors);
  return json(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      collectionId: r.collectionId,
      config: r.config ? JSON.parse(r.config) : {},
      status: r.status,
      lastSyncAt: r.lastSyncAt ?? undefined,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    type: string;
    collectionId: string;
    config: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(ragConnectors)
    .values({
      id,
      type: body.type,
      collectionId: body.collectionId,
      config: JSON.stringify(body.config ?? {}),
      status: "pending",
      lastSyncAt: null,
      createdAt: now,
    })
    .run();
  return json(
    {
      id,
      type: body.type,
      collectionId: body.collectionId,
      config: body.config ?? {},
      status: "pending",
      lastSyncAt: undefined,
      createdAt: now,
    },
    { status: 201 }
  );
}
