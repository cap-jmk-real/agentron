import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";

export type TelegramSettings = {
  enabled: boolean;
  botToken?: string;
  botTokenEnvVar?: string;
  notificationChatId?: string;
  /** When true, use getUpdates (long polling) instead of webhook. Works on localhost without a public URL. */
  usePolling?: boolean;
};

/** Safe view for API responses: never includes token. */
export type TelegramSettingsPublic = {
  enabled: boolean;
  hasToken: boolean;
  notificationChatId?: string;
  botUsername?: string;
  usePolling?: boolean;
};

const FILENAME = "telegram-settings.json";

function getSettingsPath(): string {
  return path.join(getDataDir(), FILENAME);
}

function loadRaw(): Partial<TelegramSettings> {
  const p = getSettingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as Partial<TelegramSettings>;
  } catch {
    return {};
  }
}

function save(settings: TelegramSettings): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * Returns the bot token for server-side use (bot process, getMe test).
 * Prefers env var if botTokenEnvVar is set, otherwise stored botToken.
 */
export function getTelegramBotToken(): string | undefined {
  const raw = loadRaw();
  const envVar = raw.botTokenEnvVar?.trim();
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }
  const token = raw.botToken?.trim();
  return token || undefined;
}

/**
 * Returns public-safe telegram settings for the API (no token).
 */
export function getTelegramSettings(): TelegramSettingsPublic {
  const raw = loadRaw();
  const hasToken =
    !!(raw.botTokenEnvVar?.trim() && process.env[raw.botTokenEnvVar.trim()]) ||
    !!raw.botToken?.trim();
  return {
    enabled: raw.enabled === true,
    hasToken,
    notificationChatId: raw.notificationChatId?.trim() || undefined,
    botUsername: undefined, // can be set by test endpoint or after getMe
    usePolling: raw.usePolling === true,
  };
}

/**
 * Updates telegram settings. Token is never returned.
 */
export function updateTelegramSettings(updates: Partial<TelegramSettings>): TelegramSettingsPublic {
  const current = loadRaw();
  const next: TelegramSettings = {
    ...current,
    enabled: updates.enabled !== undefined ? updates.enabled === true : current.enabled === true,
  };

  if (updates.botToken !== undefined) {
    next.botToken =
      typeof updates.botToken === "string" ? updates.botToken.trim() || undefined : undefined;
    next.botTokenEnvVar = undefined;
  }
  if (updates.botTokenEnvVar !== undefined) {
    next.botTokenEnvVar =
      typeof updates.botTokenEnvVar === "string"
        ? updates.botTokenEnvVar.trim() || undefined
        : undefined;
    next.botToken = undefined;
  }
  if (updates.notificationChatId !== undefined) {
    next.notificationChatId =
      typeof updates.notificationChatId === "string"
        ? updates.notificationChatId.trim() || undefined
        : undefined;
  }
  if (updates.usePolling !== undefined) {
    next.usePolling = updates.usePolling === true;
  }

  save(next);
  return getTelegramSettings();
}
