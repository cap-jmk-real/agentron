import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { ragDocumentStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return json({
    id: r.id,
    name: r.name,
    type: r.type,
    bucket: r.bucket,
    region: r.region ?? undefined,
    endpoint: r.endpoint ?? undefined,
    credentialsRef: r.credentialsRef ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: { name?: string; type?: string; bucket?: string; region?: string; endpoint?: string; credentialsRef?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.bucket !== undefined) updates.bucket = body.bucket;
  if (body.region !== undefined) updates.region = body.region;
  if (body.endpoint !== undefined) updates.endpoint = body.endpoint;
  if (body.credentialsRef !== undefined) updates.credentialsRef = body.credentialsRef;
  if (Object.keys(updates).length > 0) {
    await db.update(ragDocumentStores).set(updates).where(eq(ragDocumentStores.id, id)).run();
  }
  const updated = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, id));
  const r = updated[0];
  return json({
    id: r.id,
    name: r.name,
    type: r.type,
    bucket: r.bucket,
    region: r.region ?? undefined,
    endpoint: r.endpoint ?? undefined,
    credentialsRef: r.credentialsRef ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragDocumentStores).where(eq(ragDocumentStores.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(ragDocumentStores).where(eq(ragDocumentStores.id, id)).run();
  return json({ ok: true });
}
