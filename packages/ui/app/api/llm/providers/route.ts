import { json } from "../../_lib/response";
import { db, llmConfigs, toLlmConfigRow, fromLlmConfigRow } from "../../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(llmConfigs);
  return json(rows.map(fromLlmConfigRow));
}

/** Build extra for storage: include apiKey when provided from the UI (never sent to client). */
function buildExtraForStorage(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const { apiKey, rateLimit, extra: rawExtra } = payload;
  const extraObj = (rawExtra && typeof rawExtra === "object" && !Array.isArray(rawExtra)) ? rawExtra as Record<string, unknown> : {};
  const { apiKey: _drop, ...safeExtra } = extraObj;
  const out: Record<string, unknown> = { ...safeExtra };
  if (rateLimit != null) out.rateLimit = rateLimit;
  const keyFromPayload = apiKey != null ? String(apiKey).trim() : "";
  if (keyFromPayload) out.apiKey = keyFromPayload;
  return Object.keys(out).length ? out : undefined;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const id = (payload.id as string) ?? crypto.randomUUID();
  const { apiKey: _a, rateLimit: _r, extra: _e, ...rest } = payload;
  const extra = buildExtraForStorage(payload);
  const config = { ...rest, id, extra };
  await db.insert(llmConfigs).values(toLlmConfigRow(config as Parameters<typeof toLlmConfigRow>[0])).run();
  const safe = { ...config, extra: extra ? { ...extra, apiKey: undefined } : undefined };
  return json(safe, { status: 201 });
}
