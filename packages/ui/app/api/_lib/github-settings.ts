import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";

export type GitHubSettings = {
  enabled: boolean;
  autoReportRunErrors?: boolean;
  defaultRepoOwner?: string;
  defaultRepoName?: string;
  accessToken?: string;
  accessTokenEnvVar?: string;
  issueLabels?: string[];
};

/** Safe view for API responses: never includes token. */
export type GitHubSettingsPublic = {
  enabled: boolean;
  hasToken: boolean;
  autoReportRunErrors: boolean;
  defaultRepoOwner?: string;
  defaultRepoName?: string;
  issueLabels?: string[];
};

const FILENAME = "github-settings.json";

function getSettingsPath(): string {
  return path.join(getDataDir(), FILENAME);
}

function loadRaw(): Partial<GitHubSettings> {
  const p = getSettingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as Partial<GitHubSettings>;
  } catch {
    return {};
  }
}

function save(settings: GitHubSettings): void {
  const p = getSettingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), "utf-8");
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
}

/**
 * Returns the GitHub token for server-side use (create issue, test).
 * Prefers env var if accessTokenEnvVar is set, otherwise stored accessToken.
 */
export function getGitHubAccessToken(): string | undefined {
  const raw = loadRaw();
  const envVar = raw.accessTokenEnvVar?.trim();
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }
  const token = raw.accessToken?.trim();
  return token || undefined;
}

/**
 * Returns public-safe GitHub settings for the API (no token).
 */
export function getGitHubSettings(): GitHubSettingsPublic {
  const raw = loadRaw();
  const hasToken =
    !!(raw.accessTokenEnvVar?.trim() && process.env[raw.accessTokenEnvVar.trim()]) ||
    !!raw.accessToken?.trim();
  const issueLabels = Array.isArray(raw.issueLabels)
    ? raw.issueLabels
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return {
    enabled: raw.enabled === true,
    hasToken,
    autoReportRunErrors: raw.autoReportRunErrors === true,
    defaultRepoOwner: raw.defaultRepoOwner?.trim() || undefined,
    defaultRepoName: raw.defaultRepoName?.trim() || undefined,
    issueLabels: issueLabels?.length ? issueLabels : undefined,
  };
}

/**
 * Updates GitHub settings. Token is never returned.
 */
export function updateGitHubSettings(updates: Partial<GitHubSettings>): GitHubSettingsPublic {
  const current = loadRaw();
  const next: GitHubSettings = {
    ...current,
    enabled: updates.enabled !== undefined ? updates.enabled === true : current.enabled === true,
    autoReportRunErrors:
      updates.autoReportRunErrors !== undefined
        ? updates.autoReportRunErrors === true
        : current.autoReportRunErrors === true,
  };

  if (updates.defaultRepoOwner !== undefined) {
    next.defaultRepoOwner =
      typeof updates.defaultRepoOwner === "string"
        ? updates.defaultRepoOwner.trim() || undefined
        : undefined;
  }
  if (updates.defaultRepoName !== undefined) {
    next.defaultRepoName =
      typeof updates.defaultRepoName === "string"
        ? updates.defaultRepoName.trim() || undefined
        : undefined;
  }
  if (updates.accessToken !== undefined) {
    next.accessToken =
      typeof updates.accessToken === "string" ? updates.accessToken.trim() || undefined : undefined;
    next.accessTokenEnvVar = undefined;
  }
  if (updates.accessTokenEnvVar !== undefined) {
    next.accessTokenEnvVar =
      typeof updates.accessTokenEnvVar === "string"
        ? updates.accessTokenEnvVar.trim() || undefined
        : undefined;
    next.accessToken = undefined;
  }
  if (updates.issueLabels !== undefined) {
    next.issueLabels = Array.isArray(updates.issueLabels)
      ? updates.issueLabels
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      : current.issueLabels;
  }

  save(next);
  return getGitHubSettings();
}
