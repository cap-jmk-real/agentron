import { json } from "../../../_lib/response";
import { db } from "../../../_lib/db";
import { ragEncodingConfigs } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return json({
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelOrEndpoint: r.modelOrEndpoint,
    dimensions: r.dimensions,
    embeddingProviderId: r.embeddingProviderId ?? undefined,
    endpoint: r.endpoint ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  let body: {
    name?: string;
    provider?: string;
    modelOrEndpoint?: string;
    dimensions?: number;
    embeddingProviderId?: string | null;
    endpoint?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.provider !== undefined) updates.provider = body.provider;
  if (body.modelOrEndpoint !== undefined) updates.modelOrEndpoint = body.modelOrEndpoint;
  if (body.dimensions !== undefined) updates.dimensions = body.dimensions;
  if (body.embeddingProviderId !== undefined)
    updates.embeddingProviderId = body.embeddingProviderId;
  if (body.endpoint !== undefined) updates.endpoint = body.endpoint;
  if (Object.keys(updates).length > 0) {
    await db.update(ragEncodingConfigs).set(updates).where(eq(ragEncodingConfigs.id, id)).run();
  }
  const updated = await db.select().from(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, id));
  const r = updated[0];
  return json({
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelOrEndpoint: r.modelOrEndpoint,
    dimensions: r.dimensions,
    embeddingProviderId: r.embeddingProviderId ?? undefined,
    endpoint: r.endpoint ?? undefined,
    createdAt: r.createdAt,
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  await db.delete(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, id)).run();
  return json({ ok: true });
}
