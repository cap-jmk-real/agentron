/**
 * Shared logic to process one Telegram update (message from user).
 * Used by both the webhook handler and the long-polling loop.
 */
import { getConversationId, setConversationId } from "./telegram-sessions";
import { logApiError } from "./api-logger";

const TELEGRAM_API = "https://api.telegram.org/bot";

export type TelegramUpdate = {
  update_id?: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number };
  };
};

export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string
): Promise<boolean> {
  const res = await fetch(`${TELEGRAM_API}${encodeURIComponent(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const err = await res.text();
    logApiError("telegram", "sendMessage", new Error(err));
    return false;
  }
  return true;
}

/**
 * Process a single Telegram update: run chat through LLM and send reply.
 * baseUrl is the app origin for internal fetch (e.g. http://localhost:3000).
 */
export async function processTelegramUpdate(
  update: TelegramUpdate,
  token: string,
  baseUrl: string
): Promise<void> {
  const message = update.message;
  if (!message?.chat?.id) return;

  const text = message.text?.trim();
  if (!text) {
    await sendTelegramMessage(token, message.chat.id, "Send a text message to talk to Agentron.");
    return;
  }

  const chatId = String(message.chat.id);
  let conversationId = getConversationId(chatId);
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    setConversationId(chatId, conversationId);
  }

  const providersRes = await fetch(`${baseUrl}/api/llm/providers`);
  const providers = await providersRes.json();
  const providerId =
    Array.isArray(providers) && providers.length > 0
      ? (providers[0] as { id?: string }).id
      : undefined;
  if (!providerId) {
    await sendTelegramMessage(
      token,
      message.chat.id,
      "No LLM provider configured. Add one in Settings → LLM Providers."
    );
    return;
  }

  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      conversationId,
      providerId,
    }),
  });

  const chatData = (await chatRes.json()) as {
    error?: string;
    assistantContent?: string;
    content?: string;
  };
  if (!chatRes.ok) {
    const err = chatData.error ?? chatRes.statusText;
    await sendTelegramMessage(token, message.chat.id, `Error: ${err}`);
    return;
  }

  const reply = chatData.assistantContent ?? chatData.content ?? "Done.";
  const truncated = reply.length > 4000 ? reply.slice(0, 3997) + "…" : reply;
  await sendTelegramMessage(token, message.chat.id, truncated);
}
