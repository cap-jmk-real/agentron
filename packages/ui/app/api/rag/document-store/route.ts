import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragDocumentStores } from "@agentron-studio/core";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(ragDocumentStores);
  return json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      bucket: r.bucket,
      region: r.region ?? undefined,
      endpoint: r.endpoint ?? undefined,
      credentialsRef: r.credentialsRef ?? undefined,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name: string;
    type: string;
    bucket: string;
    region?: string;
    endpoint?: string;
    credentialsRef?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(ragDocumentStores)
    .values({
      id,
      name: body.name,
      type: body.type,
      bucket: body.bucket,
      region: body.region ?? null,
      endpoint: body.endpoint ?? null,
      credentialsRef: body.credentialsRef ?? null,
      createdAt: now,
    })
    .run();
  return json(
    {
      id,
      name: body.name,
      type: body.type,
      bucket: body.bucket,
      region: body.region,
      endpoint: body.endpoint,
      credentialsRef: body.credentialsRef,
      createdAt: now,
    },
    { status: 201 }
  );
}
