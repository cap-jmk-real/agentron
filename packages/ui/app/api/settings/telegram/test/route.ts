import { json } from "../../../_lib/response";
import { getTelegramBotToken } from "../../../_lib/telegram-settings";
import { logApiError } from "../../../_lib/api-logger";

export const runtime = "nodejs";

const TELEGRAM_GET_ME = "https://api.telegram.org/bot";

/**
 * POST tests the Telegram bot token.
 * Body: { token?: string } — if omitted, uses saved token.
 * Returns { ok: boolean, username?: string, error?: string }.
 */
export async function POST(request: Request) {
  try {
    let token: string | undefined;
    const body = await request.json().catch(() => ({}));
    if (typeof body.token === "string" && body.token.trim()) {
      token = body.token.trim();
    } else {
      token = getTelegramBotToken();
    }
    if (!token) {
      return json({ ok: false, error: "No token provided and no token saved" }, { status: 400 });
    }
    const res = await fetch(`${TELEGRAM_GET_ME}${encodeURIComponent(token)}/getMe`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!res.ok || !data.ok) {
      const err = data.description || res.statusText || "Telegram API error";
      return json({ ok: false, error: err });
    }
    const username = data.result?.username;
    return json({ ok: true, username: username ? `@${username}` : undefined });
  } catch (e) {
    logApiError("/api/settings/telegram/test", "POST", e);
    const message = e instanceof Error ? e.message : "Test failed";
    return json({ ok: false, error: message }, { status: 500 });
  }
}
