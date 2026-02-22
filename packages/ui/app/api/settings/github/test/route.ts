import { json } from "../../../_lib/response";
import { getGitHubAccessToken } from "../../../_lib/github-settings";
import { logApiError } from "../../../_lib/api-logger";

export const runtime = "nodejs";

const GITHUB_USER = "https://api.github.com/user";

/**
 * POST tests the GitHub token and optionally repo access.
 * Body: { token?: string, owner?: string, repo?: string }. If token omitted, uses saved token.
 * Returns { ok: boolean, error?: string }.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    let token: string | undefined;
    if (typeof body.token === "string" && body.token.trim()) {
      token = body.token.trim();
    } else {
      token = getGitHubAccessToken();
    }
    if (!token) {
      return json({ ok: false, error: "No token provided and no token saved" }, { status: 400 });
    }
    const res = await fetch(GITHUB_USER, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const err = (errBody as { message?: string }).message || res.statusText || "GitHub API error";
      return json({ ok: false, error: err });
    }
    const owner = typeof body.owner === "string" ? body.owner.trim() : undefined;
    const repo = typeof body.repo === "string" ? body.repo.trim() : undefined;
    if (owner && repo) {
      const repoRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
      if (!repoRes.ok) {
        const errBody = await repoRes.json().catch(() => ({}));
        const err =
          (errBody as { message?: string }).message || repoRes.statusText || "Repo not found";
        return json({ ok: false, error: err });
      }
    }
    return json({ ok: true });
  } catch (e) {
    logApiError("/api/settings/github/test", "POST", e);
    const message = e instanceof Error ? e.message : "Test failed";
    return json({ ok: false, error: message }, { status: 500 });
  }
}
