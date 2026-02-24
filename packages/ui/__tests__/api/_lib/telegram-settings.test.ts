import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as telegramSettings from "../../../app/api/_lib/telegram-settings";

describe("telegram-settings", () => {
  const savedEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...savedEnv };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe("getTelegramSettings", () => {
    it("returns defaults when settings file exists but has invalid JSON", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      const { getDataDir } = await import("../../../app/api/_lib/db");
      const path = await import("node:path");
      const fs = await import("node:fs");
      const p = path.join(getDataDir(), "telegram-settings.json");
      fs.writeFileSync(p, "invalid json {", "utf-8");
      try {
        const settings = mod.getTelegramSettings();
        expect(settings.enabled).toBe(false);
        expect(settings.hasToken).toBe(false);
      } finally {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }, 15000);

    it("returns hasToken true when botToken is set via update then get", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({ botToken: "secret-token" });
      const settings = mod.getTelegramSettings();
      expect(settings.hasToken).toBe(true);
      expect(settings).not.toHaveProperty("botToken");
      mod.updateTelegramSettings({ botToken: "", enabled: false });
    }, 30000);
  });

  describe("getTelegramBotToken", () => {
    it("returns token from env when botTokenEnvVar set and env has value", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      process.env.TEST_TELEGRAM_TOKEN = "env-token-value";
      mod.updateTelegramSettings({ botTokenEnvVar: "TEST_TELEGRAM_TOKEN" });
      const token = mod.getTelegramBotToken();
      expect(token).toBe("env-token-value");
      delete process.env.TEST_TELEGRAM_TOKEN;
      mod.updateTelegramSettings({ botTokenEnvVar: "", enabled: false });
    });
  });

  describe("updateTelegramSettings", () => {
    it("sets usePolling true and returns it in getTelegramSettings", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({ usePolling: true });
      const settings = mod.getTelegramSettings();
      expect(settings.usePolling).toBe(true);
      mod.updateTelegramSettings({ usePolling: false, enabled: false });
    });

    it("trims notificationChatId and sets undefined for non-string", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({
        notificationChatId: "  chat-123  ",
        enabled: false,
      });
      let settings = mod.getTelegramSettings();
      expect(settings.notificationChatId).toBe("chat-123");
      mod.updateTelegramSettings({
        notificationChatId: 42 as unknown as string,
        enabled: false,
      });
      settings = mod.getTelegramSettings();
      expect(settings.notificationChatId).toBeUndefined();
    });

    it("clears botToken when botTokenEnvVar is set", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({ botToken: "direct" });
      mod.updateTelegramSettings({ botTokenEnvVar: "OTHER_VAR" });
      const settings = mod.getTelegramSettings();
      expect(settings.hasToken).toBe(false);
      mod.updateTelegramSettings({ botTokenEnvVar: "", enabled: false });
    });

    it("sets botToken to undefined when update value is not a string", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({ botToken: 123 as unknown as string });
      const settings = mod.getTelegramSettings();
      expect(settings.hasToken).toBe(false);
      mod.updateTelegramSettings({ botToken: undefined, enabled: false });
    });

    it("sets botTokenEnvVar to undefined when update value is not a string", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({ botTokenEnvVar: 42 as unknown as string });
      const settings = mod.getTelegramSettings();
      expect(settings.hasToken).toBe(false);
      mod.updateTelegramSettings({ botTokenEnvVar: "", enabled: false });
    });
  });
});
