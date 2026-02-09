import { json } from "../../../_lib/response";
import { db, llmConfigs, toLlmConfigRow } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Build extra for storage; on PUT, merge with existing apiKey if new one is empty. */
async function buildExtraForPut(id: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const { apiKey, rateLimit, extra: rawExtra } = payload;
  const extraObj = (rawExtra && typeof rawExtra === "object" && !Array.isArray(rawExtra)) ? rawExtra as Record<string, unknown> : {};
  const { apiKey: _drop, ...safeExtra } = extraObj;
  const out: Record<string, unknown> = { ...safeExtra };
  if (rateLimit != null) out.rateLimit = rateLimit;
  const keyFromPayload = apiKey != null ? String(apiKey).trim() : "";
  if (keyFromPayload) {
    out.apiKey = keyFromPayload;
  } else {
    const rows = await db.select().from(llmConfigs).where(eq(llmConfigs.id, id));
    const existing = rows[0];
    if (existing?.extra) {
      try {
        const parsed = JSON.parse(existing.extra) as Record<string, unknown>;
        if (typeof parsed.apiKey === "string") out.apiKey = parsed.apiKey;
      } catch {
        // ignore
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const payload = (await request.json()) as Record<string, unknown>;
  const { apiKey: _a, rateLimit: _r, extra: _e, ...rest } = payload;
  const extra = await buildExtraForPut(id, payload);
  const config = { ...rest, id, extra };
  await db.update(llmConfigs).set(toLlmConfigRow(config as Parameters<typeof toLlmConfigRow>[0])).where(eq(llmConfigs.id, id)).run();
  const safe = { ...config, extra: extra ? { ...extra, apiKey: undefined } : undefined };
  return json(safe);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(llmConfigs).where(eq(llmConfigs.id, id)).run();
  return json({ ok: true });
}
