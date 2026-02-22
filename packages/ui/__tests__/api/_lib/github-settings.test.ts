import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "../../../app/api/_lib/db";
import {
  getGitHubSettings,
  updateGitHubSettings,
  getGitHubAccessToken,
} from "../../../app/api/_lib/github-settings";

function getSettingsPath(): string {
  return path.join(getDataDir(), "github-settings.json");
}

describe("github-settings", () => {
  afterEach(() => {
    const p = getSettingsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it("getGitHubSettings returns defaults when no file", () => {
    const s = getGitHubSettings();
    expect(s.enabled).toBe(false);
    expect(s.hasToken).toBe(false);
    expect(s.autoReportRunErrors).toBe(false);
    expect(s.defaultRepoOwner).toBeUndefined();
    expect(s.defaultRepoName).toBeUndefined();
  });

  it("getGitHubSettings returns defaults when file has invalid JSON", () => {
    fs.writeFileSync(getSettingsPath(), "not json {", "utf-8");
    const s = getGitHubSettings();
    expect(s.enabled).toBe(false);
    expect(s.hasToken).toBe(false);
  });

  it("getGitHubSettings returns hasToken true when accessToken set", () => {
    updateGitHubSettings({ accessToken: "ghp_abc123" });
    const s = getGitHubSettings();
    expect(s.hasToken).toBe(true);
    expect(s).not.toHaveProperty("accessToken");
  });

  it("getGitHubAccessToken returns token when set", () => {
    updateGitHubSettings({ accessToken: "ghp_secret" });
    expect(getGitHubAccessToken()).toBe("ghp_secret");
  });

  it("getGitHubAccessToken returns undefined when empty", () => {
    expect(getGitHubAccessToken()).toBeUndefined();
  });

  it("getGitHubAccessToken returns token from env when accessTokenEnvVar set", () => {
    const envVar = "GITHUB_TOKEN_TEST_COVERAGE";
    const orig = process.env[envVar];
    process.env[envVar] = "token-from-env";
    try {
      updateGitHubSettings({ accessTokenEnvVar: envVar });
      expect(getGitHubAccessToken()).toBe("token-from-env");
    } finally {
      if (orig !== undefined) process.env[envVar] = orig;
      else delete process.env[envVar];
    }
  });

  it("updateGitHubSettings updates and returns public shape", () => {
    const s = updateGitHubSettings({
      enabled: true,
      autoReportRunErrors: true,
      defaultRepoOwner: "myorg",
      defaultRepoName: "myrepo",
      accessToken: "ghp_x",
    });
    expect(s.enabled).toBe(true);
    expect(s.autoReportRunErrors).toBe(true);
    expect(s.defaultRepoOwner).toBe("myorg");
    expect(s.defaultRepoName).toBe("myrepo");
    expect(s.hasToken).toBe(true);
    expect(s).not.toHaveProperty("accessToken");
  });

  it("updateGitHubSettings trims owner and repo", () => {
    updateGitHubSettings({
      defaultRepoOwner: "  org  ",
      defaultRepoName: "  repo  ",
    });
    const s = getGitHubSettings();
    expect(s.defaultRepoOwner).toBe("org");
    expect(s.defaultRepoName).toBe("repo");
  });

  it("updateGitHubSettings with accessTokenEnvVar clears accessToken", () => {
    updateGitHubSettings({ accessToken: "ghp_old" });
    updateGitHubSettings({ accessTokenEnvVar: "GITHUB_TOKEN" });
    const s = getGitHubSettings();
    expect(s.hasToken).toBe(!!process.env.GITHUB_TOKEN);
  });

  it("updateGitHubSettings with issueLabels filters to strings", () => {
    updateGitHubSettings({
      issueLabels: ["agentron", "run-error", 1, null, ""] as unknown as string[],
    });
    const s = getGitHubSettings();
    expect(s.issueLabels).toEqual(["agentron", "run-error"]);
  });

  it("getGitHubSettings returns issueLabels undefined when empty array", () => {
    updateGitHubSettings({ issueLabels: [] });
    const s = getGitHubSettings();
    expect(s.issueLabels).toBeUndefined();
  });

  it("updateGitHubSettings with non-string defaultRepoOwner clears to undefined", () => {
    updateGitHubSettings({ defaultRepoOwner: "org" });
    updateGitHubSettings({ defaultRepoOwner: null as unknown as string });
    const s = getGitHubSettings();
    expect(s.defaultRepoOwner).toBeUndefined();
  });
});
