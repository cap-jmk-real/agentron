import { json } from "../../_lib/response";
import { getTelegramBotToken } from "../../_lib/telegram-settings";
import { getConversationId, setConversationId } from "../../_lib/telegram-sessions";
import { logApiError } from "../../_lib/api-logger";

export const runtime = "nodejs";

const TELEGRAM_API = "https://api.telegram.org/bot";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number };
  };
};

function getOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.AGENTRON_PUBLIC_URL ?? "http://localhost:3000";
  }
}

async function sendTelegramMessage(token: string, chatId: number, text: string): Promise<boolean> {
  const res = await fetch(`${TELEGRAM_API}${encodeURIComponent(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const err = await res.text();
    logApiError("/api/telegram/webhook", "sendMessage", new Error(err));
    return false;
  }
  return true;
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

    const text = message.text?.trim();
    if (!text) {
      await sendTelegramMessage(token, message.chat.id, "Send a text message to talk to Agentron.");
      return json({ ok: true });
    }

    const chatId = String(message.chat.id);
    let conversationId = getConversationId(chatId);
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      setConversationId(chatId, conversationId);
    }

    const origin = getOrigin(request);
    const providersRes = await fetch(`${origin}/api/llm/providers`);
    const providers = await providersRes.json();
    const providerId = Array.isArray(providers) && providers.length > 0 ? (providers[0] as { id?: string }).id : undefined;
    if (!providerId) {
      await sendTelegramMessage(token, message.chat.id, "No LLM provider configured. Add one in Settings → LLM Providers.");
      return json({ ok: true });
    }

    const chatRes = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        conversationId,
        providerId,
      }),
    });

    const chatData = (await chatRes.json()) as { error?: string; assistantContent?: string; content?: string };
    if (!chatRes.ok) {
      const err = chatData.error ?? chatRes.statusText;
      await sendTelegramMessage(token, message.chat.id, `Error: ${err}`);
      return json({ ok: true });
    }

    const reply = chatData.assistantContent ?? chatData.content ?? "Done.";
    const truncated = reply.length > 4000 ? reply.slice(0, 3997) + "…" : reply;
    await sendTelegramMessage(token, message.chat.id, truncated);
    return json({ ok: true });
  } catch (e) {
    logApiError("/api/telegram/webhook", "POST", e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
