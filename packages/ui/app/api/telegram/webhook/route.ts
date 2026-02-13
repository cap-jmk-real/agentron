import { json } from "../../_lib/response";
import { getTelegramBotToken } from "../../_lib/telegram-settings";
import { processTelegramUpdate, type TelegramUpdate } from "../../_lib/telegram-update";
import { logApiError } from "../../_lib/api-logger";

export const runtime = "nodejs";

function getOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.AGENTRON_PUBLIC_URL ?? "http://localhost:3000";
  }
}

/** POST receives Telegram webhook updates. Requires Telegram enabled and token. Optional: ?secret= for TELEGRAM_WEBHOOK_SECRET. */
export async function POST(request: Request) {
  try {
    const token = getTelegramBotToken();
    if (!token) {
      return json({ error: "Telegram not configured" }, { status: 503 });
    }

    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const q = new URL(request.url).searchParams.get("secret");
      if (q !== secret) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = (await request.json()) as TelegramUpdate;
    const message = body.message;
    if (!message?.chat?.id) {
      return json({ ok: true });
    }

    const origin = getOrigin(request);
    await processTelegramUpdate(body, token, origin);
    return json({ ok: true });
  } catch (e) {
    logApiError("/api/telegram/webhook", "POST", e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
