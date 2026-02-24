import { json } from "../../_lib/response";
import { db, llmConfigs, toLlmConfigRow, fromLlmConfigRow } from "../../_lib/db";
import { logApiError, appendLogLine } from "../../_lib/api-logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db.select().from(llmConfigs);
    const configs = rows.map(fromLlmConfigRow);
    const safe = configs.map((c) => {
      const extra =
        c.extra && typeof c.extra === "object" && !Array.isArray(c.extra)
          ? { ...(c.extra as Record<string, unknown>), apiKey: undefined }
          : c.extra;
      return { ...c, extra };
    });
    return json(safe);
  } catch (err) {
    logApiError("/api/llm/providers", "GET", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
}

/** Build extra for storage: include apiKey when provided from the UI (never sent to client). */
function buildExtraForStorage(
  payload: Record<string, unknown>
): Record<string, unknown> | undefined {
  const { apiKey, rateLimit, contextLength, extra: rawExtra } = payload;
  const extraObj =
    rawExtra && typeof rawExtra === "object" && !Array.isArray(rawExtra)
      ? (rawExtra as Record<string, unknown>)
      : {};
  const { apiKey: _drop, ...safeExtra } = extraObj;
  const out: Record<string, unknown> = { ...safeExtra };
  if (rateLimit != null) out.rateLimit = rateLimit;
  if (contextLength != null && contextLength !== "") {
    const n =
      typeof contextLength === "number" ? contextLength : parseInt(String(contextLength), 10);
    if (Number.isInteger(n) && n > 0) out.contextLength = n;
  }
  const keyFromPayload = apiKey != null ? String(apiKey).trim() : "";
  if (keyFromPayload) out.apiKey = keyFromPayload;
  return Object.keys(out).length ? out : undefined;
}

export async function POST(request: Request) {
  const route = "/api/llm/providers";
  appendLogLine(route, "POST", "request received");
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const id = (payload.id as string) ?? crypto.randomUUID();
    const { apiKey: _a, rateLimit: _r, extra: _e, ...rest } = payload;
    const extra = buildExtraForStorage(payload);
    const config = { ...rest, id, extra };
    await db
      .insert(llmConfigs)
      .values(toLlmConfigRow(config as Parameters<typeof toLlmConfigRow>[0]))
      .run();
    const safe = { ...config, extra: extra ? { ...extra, apiKey: undefined } : undefined };
    return json(safe, { status: 201 });
  } catch (err) {
    try {
      logApiError(route, "POST", err);
    } catch (logErr) {
      // Ensure we don't lose the original error if logging fails
      console.error("[agentron] logApiError failed:", logErr);
    }
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
}
