import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragEncodingConfigs } from "@agentron-studio/core";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(ragEncodingConfigs);
  return json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      modelOrEndpoint: r.modelOrEndpoint,
      dimensions: r.dimensions,
      embeddingProviderId: r.embeddingProviderId ?? undefined,
      endpoint: r.endpoint ?? undefined,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name: string;
    provider?: string;
    modelOrEndpoint: string;
    dimensions: number;
    embeddingProviderId?: string | null;
    endpoint?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  const provider = body.embeddingProviderId != null ? "openai" : (body.provider ?? "openai");
  await db
    .insert(ragEncodingConfigs)
    .values({
      id,
      name: body.name,
      provider,
      modelOrEndpoint: body.modelOrEndpoint,
      dimensions: body.dimensions,
      embeddingProviderId: body.embeddingProviderId ?? null,
      endpoint: body.endpoint ?? null,
      createdAt: now,
    })
    .run();
  return json(
    {
      id,
      name: body.name,
      provider: body.embeddingProviderId != null ? undefined : provider,
      modelOrEndpoint: body.modelOrEndpoint,
      dimensions: body.dimensions,
      embeddingProviderId: body.embeddingProviderId ?? undefined,
      endpoint: body.endpoint ?? undefined,
      createdAt: now,
    },
    { status: 201 }
  );
}
