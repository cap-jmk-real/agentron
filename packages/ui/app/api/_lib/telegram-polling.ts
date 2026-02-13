/**
 * Long polling for Telegram updates (getUpdates). Use when webhook is not set.
 * No public URL needed; works on localhost. Run after enabling Telegram with "Use polling".
 */
import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";
import { getTelegramBotToken, getTelegramSettings } from "./telegram-settings";
import { processTelegramUpdate, type TelegramUpdate } from "./telegram-update";
import { logApiError } from "./api-logger";

const TELEGRAM_API = "https://api.telegram.org/bot";
const POLL_INTERVAL_MS = 500;
const GET_UPDATES_TIMEOUT_SEC = 25;

const OFFSET_FILENAME = "telegram-poll-offset.json";

function getOffsetPath(): string {
  return path.join(getDataDir(), OFFSET_FILENAME);
}

function loadLastUpdateId(): number {
  const p = getOffsetPath();
  if (!fs.existsSync(p)) return 0;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as { lastUpdateId?: number };
    return typeof data.lastUpdateId === "number" ? data.lastUpdateId : 0;
  } catch {
    return 0;
  }
}

function saveLastUpdateId(updateId: number): void {
  const p = getOffsetPath();
  try {
    fs.writeFileSync(p, JSON.stringify({ lastUpdateId: updateId }, null, 2), "utf-8");
  } catch (e) {
    logApiError("telegram-polling", "saveOffset", e instanceof Error ? e : new Error(String(e)));
  }
}

async function deleteWebhook(token: string): Promise<void> {
  const url = `${TELEGRAM_API}${encodeURIComponent(token)}/deleteWebhook`;
  try {
    await fetch(url, { method: "POST" });
  } catch (e) {
    logApiError("telegram-polling", "deleteWebhook", e instanceof Error ? e : new Error(String(e)));
  }
}

async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  const url = `${TELEGRAM_API}${encodeURIComponent(token)}/getUpdates?timeout=${GET_UPDATES_TIMEOUT_SEC}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
  if (!data.ok || !Array.isArray(data.result)) return [];
  return data.result;
}

let running = false;
let loopPromise: Promise<void> | null = null;

function getBaseUrl(): string {
  return process.env.AGENTRON_PUBLIC_URL ?? "http://127.0.0.1:3000";
}

async function runLoop(): Promise<void> {
  const token = getTelegramBotToken();
  const settings = getTelegramSettings();
  if (!token || !settings.enabled || !settings.usePolling) {
    running = false;
    return;
  }

  await deleteWebhook(token);
  let lastUpdateId = loadLastUpdateId();
  const baseUrl = getBaseUrl();

  while (running) {
    try {
      const updates = await getUpdates(token, lastUpdateId + 1);
      for (const update of updates) {
        if (typeof update.update_id === "number") {
          lastUpdateId = update.update_id;
          saveLastUpdateId(lastUpdateId);
        }
        await processTelegramUpdate(update, token, baseUrl);
      }
    } catch (e) {
      logApiError("telegram-polling", "getUpdates", e instanceof Error ? e : new Error(String(e)));
    }
    if (!running) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * Start the polling loop if Telegram is enabled with usePolling and we have a token.
 * Idempotent: if already running, does nothing.
 */
export function ensurePollingStarted(): void {
  const settings = getTelegramSettings();
  if (!settings.enabled || !settings.usePolling || !getTelegramBotToken()) return;
  if (running) return;

  running = true;
  loopPromise = runLoop();
}

/**
 * Stop the polling loop (e.g. when user disables Telegram or switches to webhook).
 */
export function stopPolling(): void {
  running = false;
}

export function isPollingRunning(): boolean {
  return running;
}
