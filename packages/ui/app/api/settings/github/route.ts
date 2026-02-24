import { json } from "../../_lib/response";
import { getGitHubSettings, updateGitHubSettings } from "../../_lib/github-settings";
import { logApiError } from "../../_lib/api-logger";

export const runtime = "nodejs";

/** GET returns GitHub settings (no token). */
export async function GET() {
  try {
    const settings = getGitHubSettings();
    return json(settings);
  } catch (e) {
    logApiError("/api/settings/github", "GET", e);
    const message = e instanceof Error ? e.message : "Failed to load GitHub settings";
    return json({ error: message }, { status: 500 });
  }
}

/** PATCH updates GitHub settings. Body: { enabled?, autoReportRunErrors?, defaultRepoOwner?, defaultRepoName?, accessToken?, accessTokenEnvVar?, issueLabels? }. Token is never returned. */
export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const updates: Partial<{
      enabled: boolean;
      autoReportRunErrors: boolean;
      defaultRepoOwner: string;
      defaultRepoName: string;
      accessToken: string;
      accessTokenEnvVar: string;
      issueLabels: string[];
    }> = {};
    if (typeof payload.enabled === "boolean") updates.enabled = payload.enabled;
    if (typeof payload.autoReportRunErrors === "boolean")
      updates.autoReportRunErrors = payload.autoReportRunErrors;
    if (typeof payload.defaultRepoOwner === "string")
      updates.defaultRepoOwner = payload.defaultRepoOwner;
    if (typeof payload.defaultRepoName === "string")
      updates.defaultRepoName = payload.defaultRepoName;
    if (typeof payload.accessToken === "string") updates.accessToken = payload.accessToken;
    if (typeof payload.accessTokenEnvVar === "string")
      updates.accessTokenEnvVar = payload.accessTokenEnvVar;
    if (Array.isArray(payload.issueLabels))
      updates.issueLabels = payload.issueLabels.filter(
        (x: unknown): x is string => typeof x === "string"
      );
    const settings = updateGitHubSettings(updates);
    return json(settings);
  } catch (e) {
    logApiError("/api/settings/github", "PATCH", e);
    const message = e instanceof Error ? e.message : "Failed to update GitHub settings";
    return json({ error: message }, { status: 500 });
  }
}
