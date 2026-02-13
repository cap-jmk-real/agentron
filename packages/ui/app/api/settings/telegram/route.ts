import { json } from "../../_lib/response";
import { getTelegramSettings, updateTelegramSettings } from "../../_lib/telegram-settings";
import { logApiError } from "../../_lib/api-logger";

export const runtime = "nodejs";

/** GET returns telegram settings (no token). */
export async function GET() {
  try {
    const settings = getTelegramSettings();
    return json(settings);
  } catch (e) {
    logApiError("/api/settings/telegram", "GET", e);
    const message = e instanceof Error ? e.message : "Failed to load Telegram settings";
    return json({ error: message }, { status: 500 });
  }
}

/** PATCH updates telegram settings. Body: { enabled?, botToken?, botTokenEnvVar?, notificationChatId? }. Token is never returned. */
export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const updates: Partial<{ enabled: boolean; botToken: string; botTokenEnvVar: string; notificationChatId: string }> = {};
    if (typeof payload.enabled === "boolean") updates.enabled = payload.enabled;
    if (typeof payload.botToken === "string") updates.botToken = payload.botToken;
    if (typeof payload.botTokenEnvVar === "string") updates.botTokenEnvVar = payload.botTokenEnvVar;
    if (typeof payload.notificationChatId === "string") updates.notificationChatId = payload.notificationChatId;
    const settings = updateTelegramSettings(updates);
    return json(settings);
  } catch (e) {
    logApiError("/api/settings/telegram", "PATCH", e);
    const message = e instanceof Error ? e.message : "Failed to update Telegram settings";
    return json({ error: message }, { status: 500 });
  }
}
