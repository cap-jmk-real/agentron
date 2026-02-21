import { json } from "../../_lib/response";
import { db } from "../../_lib/db";
import { ragEmbeddingProviders } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

function safeProviderRow(r: typeof ragEmbeddingProviders.$inferSelect & { extra?: string | null }) {
  const extra = r.extra ? (JSON.parse(r.extra) as Record<string, unknown>) : undefined;
  const apiKeySet = !!(
    (r.apiKeyRef && typeof process !== "undefined" && process.env?.[r.apiKeyRef]) ||
    (extra && typeof (extra as { apiKey?: string }).apiKey === "string")
  );
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    endpoint: r.endpoint ?? undefined,
    apiKeySet,
    createdAt: r.createdAt,
  };
}

export async function GET() {
  const rows = await db.select().from(ragEmbeddingProviders);
  return json(rows.map((r) => safeProviderRow(r)));
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name: string;
    type: string;
    endpoint?: string | null;
    apiKeyRef?: string | null;
    extra?: Record<string, unknown> | string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name?.trim() || !body.type?.trim()) {
    return json({ error: "name and type are required" }, { status: 400 });
  }
  const extraStr =
    body.extra == null
      ? null
      : typeof body.extra === "string"
        ? body.extra
        : JSON.stringify(body.extra);
  const id = body.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(ragEmbeddingProviders)
    .values({
      id,
      name: body.name.trim(),
      type: body.type.trim(),
      endpoint: body.endpoint?.trim() || null,
      apiKeyRef: body.apiKeyRef?.trim() || null,
      extra: extraStr,
      createdAt: now,
    })
    .run();
  const rows = await db
    .select()
    .from(ragEmbeddingProviders)
    .where(eq(ragEmbeddingProviders.id, id));
  const r = rows[0];
  if (!r) return json({ error: "Failed to read created provider" }, { status: 500 });
  return json(safeProviderRow(r), { status: 201 });
}
