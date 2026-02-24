import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "../../../app/api/_lib/db";
import {
  getMaxFileUploadBytes,
  getContainerEngine,
  getShellCommandAllowlist,
  getWorkflowMaxSelfFixRetries,
  getAppSettings,
  updateAppSettings,
  formatMaxFileUploadMb,
} from "../../../app/api/_lib/app-settings";

function getSettingsPath(): string {
  return path.join(getDataDir(), "app-settings.json");
}

function writeSettings(obj: object): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(obj), "utf-8");
}

describe("app-settings", () => {
  afterEach(() => {
    if (fs.existsSync(getSettingsPath())) {
      fs.unlinkSync(getSettingsPath());
    }
  });

  it("getMaxFileUploadBytes returns default when no file", () => {
    expect(getMaxFileUploadBytes()).toBe(50 * 1024 * 1024);
  });

  it("getMaxFileUploadBytes returns default when file has invalid JSON", () => {
    fs.writeFileSync(getSettingsPath(), "not json {", "utf-8");
    expect(getMaxFileUploadBytes()).toBe(50 * 1024 * 1024);
  });

  it("getMaxFileUploadBytes returns default when invalid or out of range", () => {
    writeSettings({ maxFileUploadBytes: NaN });
    expect(getMaxFileUploadBytes()).toBe(50 * 1024 * 1024);
    writeSettings({ maxFileUploadBytes: 1024 });
    expect(getMaxFileUploadBytes()).toBe(50 * 1024 * 1024);
    writeSettings({ maxFileUploadBytes: 600 * 1024 * 1024 });
    expect(getMaxFileUploadBytes()).toBe(50 * 1024 * 1024);
  });

  it("getMaxFileUploadBytes returns floored value when valid", () => {
    writeSettings({ maxFileUploadBytes: 10 * 1024 * 1024 });
    expect(getMaxFileUploadBytes()).toBe(10 * 1024 * 1024);
  });

  it("getContainerEngine returns docker when set", () => {
    writeSettings({ containerEngine: "docker" });
    expect(getContainerEngine()).toBe("docker");
  });

  it("getContainerEngine returns podman when unset or invalid", () => {
    expect(getContainerEngine()).toBe("podman");
    writeSettings({ containerEngine: "podman" });
    expect(getContainerEngine()).toBe("podman");
    writeSettings({ containerEngine: "other" });
    expect(getContainerEngine()).toBe("podman");
  });

  it("getShellCommandAllowlist returns [] when not array", () => {
    writeSettings({ shellCommandAllowlist: "not array" });
    expect(getShellCommandAllowlist()).toEqual([]);
  });

  it("getShellCommandAllowlist filters and trims strings", () => {
    writeSettings({ shellCommandAllowlist: ["  ls  ", "pwd", "", 1, null] });
    expect(getShellCommandAllowlist()).toEqual(["ls", "pwd"]);
  });

  it("getWorkflowMaxSelfFixRetries returns default when invalid", () => {
    writeSettings({ workflowMaxSelfFixRetries: NaN });
    expect(getWorkflowMaxSelfFixRetries()).toBe(3);
  });

  it("getWorkflowMaxSelfFixRetries clamps to 0-10", () => {
    writeSettings({ workflowMaxSelfFixRetries: 5 });
    expect(getWorkflowMaxSelfFixRetries()).toBe(5);
    writeSettings({ workflowMaxSelfFixRetries: -1 });
    expect(getWorkflowMaxSelfFixRetries()).toBe(0);
    writeSettings({ workflowMaxSelfFixRetries: 20 });
    expect(getWorkflowMaxSelfFixRetries()).toBe(10);
  });

  it("getAppSettings returns all four fields", () => {
    const s = getAppSettings();
    expect(s).toHaveProperty("maxFileUploadBytes");
    expect(s).toHaveProperty("containerEngine");
    expect(s).toHaveProperty("shellCommandAllowlist");
    expect(s).toHaveProperty("workflowMaxSelfFixRetries");
  });

  it("getAppSettings returns webSearchProvider default duckduckgo when unset or invalid", () => {
    expect(getAppSettings().webSearchProvider).toBe("duckduckgo");
    writeSettings({ webSearchProvider: "other" });
    expect(getAppSettings().webSearchProvider).toBe("duckduckgo");
    writeSettings({ webSearchProvider: null });
    expect(getAppSettings().webSearchProvider).toBe("duckduckgo");
  });

  it("getAppSettings returns webSearchProvider brave or google when set", () => {
    writeSettings({ webSearchProvider: "brave" });
    expect(getAppSettings().webSearchProvider).toBe("brave");
    writeSettings({ webSearchProvider: "google" });
    expect(getAppSettings().webSearchProvider).toBe("google");
  });

  it("getAppSettings returns braveSearchApiKey and google keys when set", () => {
    writeSettings({
      braveSearchApiKey: " key1 ",
      googleCseKey: "gk",
      googleCseCx: "gcx",
    });
    const s = getAppSettings();
    expect(s.braveSearchApiKey).toBe("key1");
    expect(s.googleCseKey).toBe("gk");
    expect(s.googleCseCx).toBe("gcx");
  });

  it("getAppSettings returns undefined for empty or non-string web search keys", () => {
    writeSettings({
      braveSearchApiKey: "",
      googleCseKey: "  ",
      googleCseCx: 123,
    });
    const s = getAppSettings();
    expect(s.braveSearchApiKey).toBeUndefined();
    expect(s.googleCseKey).toBeUndefined();
    expect(s.googleCseCx).toBeUndefined();
  });

  it("updateAppSettings updates web search provider and keys", () => {
    updateAppSettings({ webSearchProvider: "brave", braveSearchApiKey: "brave-key" });
    let s = getAppSettings();
    expect(s.webSearchProvider).toBe("brave");
    expect(s.braveSearchApiKey).toBe("brave-key");
    updateAppSettings({ webSearchProvider: "google", googleCseKey: "gkey", googleCseCx: "gcx" });
    s = getAppSettings();
    expect(s.webSearchProvider).toBe("google");
    expect(s.googleCseKey).toBe("gkey");
    expect(s.googleCseCx).toBe("gcx");
  });

  it("updateAppSettings normalizes invalid webSearchProvider to duckduckgo", () => {
    writeSettings({ webSearchProvider: "brave" });
    updateAppSettings({ webSearchProvider: "invalid" as unknown as "duckduckgo" });
    expect(getAppSettings().webSearchProvider).toBe("duckduckgo");
  });

  it("updateAppSettings trims and empties optional key strings", () => {
    updateAppSettings({ braveSearchApiKey: "  x  " });
    expect(getAppSettings().braveSearchApiKey).toBe("x");
    updateAppSettings({ braveSearchApiKey: "" });
    expect(getAppSettings().braveSearchApiKey).toBeUndefined();
  });

  it("updateAppSettings updates and clamps maxFileUploadBytes", () => {
    const updated = updateAppSettings({ maxFileUploadBytes: 20 * 1024 * 1024 });
    expect(updated.maxFileUploadBytes).toBe(20 * 1024 * 1024);
    const clamped = updateAppSettings({ maxFileUploadBytes: 0 });
    expect(clamped.maxFileUploadBytes).toBe(1024 * 1024);
  });

  it("updateAppSettings leaves maxFileUploadBytes unchanged when update is NaN", () => {
    writeSettings({ maxFileUploadBytes: 10 * 1024 * 1024 });
    const before = getAppSettings().maxFileUploadBytes;
    updateAppSettings({ maxFileUploadBytes: Number.NaN });
    expect(getAppSettings().maxFileUploadBytes).toBe(before);
  });

  it("updateAppSettings updates containerEngine and shellCommandAllowlist", () => {
    updateAppSettings({ containerEngine: "docker", shellCommandAllowlist: ["ls"] });
    const s = getAppSettings();
    expect(s.containerEngine).toBe("docker");
    expect(s.shellCommandAllowlist).toEqual(["ls"]);
  });

  it("formatMaxFileUploadMb returns formatted string", () => {
    expect(formatMaxFileUploadMb(5 * 1024 * 1024)).toBe("5 MB");
  });
});
