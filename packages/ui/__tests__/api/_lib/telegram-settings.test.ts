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
    it("returns hasToken true when botToken is set via update then get", async () => {
      const mod = await import("../../../app/api/_lib/telegram-settings");
      mod.updateTelegramSettings({ botToken: "secret-token" });
      const settings = mod.getTelegramSettings();
      expect(settings.hasToken).toBe(true);
      expect(settings).not.toHaveProperty("botToken");
      mod.updateTelegramSettings({ botToken: "", enabled: false });
    });
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
  });
});
