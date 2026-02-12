import { json } from "../../_lib/response";
import { db, chatAssistantSettings, fromChatAssistantSettingsRow, toChatAssistantSettingsRow } from "../../_lib/db";
import { eq } from "drizzle-orm";

const DEFAULT_ID = "default";

export async function GET() {
  const rows = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, DEFAULT_ID));
  if (rows.length === 0) {
    return json({
      id: DEFAULT_ID,
      customSystemPrompt: null,
      contextAgentIds: null,
      contextWorkflowIds: null,
      contextToolIds: null,
      recentSummariesCount: 3,
      temperature: 0.7,
      historyCompressAfter: 24,
      historyKeepRecent: 16,
      updatedAt: Date.now(),
    });
  }
  return json(fromChatAssistantSettingsRow(rows[0]));
}

export async function PATCH(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const customSystemPrompt =
    payload.customSystemPrompt === undefined
      ? undefined
      : payload.customSystemPrompt === null || payload.customSystemPrompt === ""
        ? null
        : String(payload.customSystemPrompt).trim() || null;
  const contextAgentIds = Array.isArray(payload.contextAgentIds)
    ? payload.contextAgentIds.filter((x: unknown) => typeof x === "string")
    : undefined;
  const contextWorkflowIds = Array.isArray(payload.contextWorkflowIds)
    ? payload.contextWorkflowIds.filter((x: unknown) => typeof x === "string")
    : undefined;
  const contextToolIds = Array.isArray(payload.contextToolIds)
    ? payload.contextToolIds.filter((x: unknown) => typeof x === "string")
    : undefined;
  let recentSummariesCount: number | undefined;
  if (payload.recentSummariesCount !== undefined) {
    const n = Number(payload.recentSummariesCount);
    recentSummariesCount = Number.isNaN(n) ? 3 : Math.min(10, Math.max(1, Math.round(n)));
  }
  let temperature: number | undefined;
  if (payload.temperature !== undefined) {
    const t = Number(payload.temperature);
    temperature = Number.isNaN(t) ? 0.7 : Math.min(2, Math.max(0, t));
  }
  const DEFAULT_COMPRESS_AFTER = 24;
  const DEFAULT_KEEP_RECENT = 16;
  const MIN_COMPRESS = 10;
  const MAX_COMPRESS = 200;
  const MIN_KEEP = 5;
  const MAX_KEEP = 100;
  let historyCompressAfter: number | undefined;
  if (payload.historyCompressAfter !== undefined) {
    const n = Number(payload.historyCompressAfter);
    historyCompressAfter = Number.isNaN(n) ? DEFAULT_COMPRESS_AFTER : Math.min(MAX_COMPRESS, Math.max(MIN_COMPRESS, Math.round(n)));
  }
  let historyKeepRecent: number | undefined;
  if (payload.historyKeepRecent !== undefined) {
    const n = Number(payload.historyKeepRecent);
    historyKeepRecent = Number.isNaN(n) ? DEFAULT_KEEP_RECENT : Math.min(MAX_KEEP, Math.max(MIN_KEEP, Math.round(n)));
  }

  const rows = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, DEFAULT_ID));
  const now = Date.now();

  if (rows.length === 0) {
    const row = toChatAssistantSettingsRow({
      id: DEFAULT_ID,
      customSystemPrompt: customSystemPrompt ?? null,
      contextAgentIds: contextAgentIds ?? null,
      contextWorkflowIds: contextWorkflowIds ?? null,
      contextToolIds: contextToolIds ?? null,
      recentSummariesCount: recentSummariesCount ?? 3,
      temperature: temperature ?? 0.7,
      historyCompressAfter: historyCompressAfter ?? DEFAULT_COMPRESS_AFTER,
      historyKeepRecent: historyKeepRecent ?? DEFAULT_KEEP_RECENT,
      updatedAt: now,
    });
    await db.insert(chatAssistantSettings).values(row).run();
    return json(fromChatAssistantSettingsRow(row as typeof rows[0]));
  }

  const current = fromChatAssistantSettingsRow(rows[0]);
  const updates: Record<string, unknown> = {
    updatedAt: now,
  };
  if (customSystemPrompt !== undefined) updates.customSystemPrompt = customSystemPrompt;
  if (contextAgentIds !== undefined) updates.contextAgentIds = contextAgentIds;
  if (contextWorkflowIds !== undefined) updates.contextWorkflowIds = contextWorkflowIds;
  if (contextToolIds !== undefined) updates.contextToolIds = contextToolIds;
  if (recentSummariesCount !== undefined) updates.recentSummariesCount = recentSummariesCount;
  if (temperature !== undefined) updates.temperature = temperature;
  if (historyCompressAfter !== undefined) updates.historyCompressAfter = historyCompressAfter;
  if (historyKeepRecent !== undefined) updates.historyKeepRecent = historyKeepRecent;

  await db
    .update(chatAssistantSettings)
    .set(updates as Record<string, string | number | null>)
    .where(eq(chatAssistantSettings.id, DEFAULT_ID))
    .run();

  const updated = await db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, DEFAULT_ID));
  return json(fromChatAssistantSettingsRow(updated[0]));
}
