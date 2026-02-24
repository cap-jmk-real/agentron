import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";

const FILENAME = "telegram-chat-sessions.json";

function getSessionsPath(): string {
  return path.join(getDataDir(), FILENAME);
}

type Sessions = Record<string, string>;

function load(): Sessions {
  const p = getSessionsPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as Sessions;
  } catch {
    return {};
  }
}

function save(sessions: Sessions): void {
  fs.writeFileSync(getSessionsPath(), JSON.stringify(sessions, null, 2), "utf-8");
}

/** Get conversationId for a Telegram chat_id (string). */
export function getConversationId(telegramChatId: string): string | undefined {
  const sessions = load();
  return sessions[telegramChatId];
}

/** Bind a Telegram chat to a conversation. */
export function setConversationId(telegramChatId: string, conversationId: string): void {
  const sessions = load();
  sessions[telegramChatId] = conversationId;
  save(sessions);
}
