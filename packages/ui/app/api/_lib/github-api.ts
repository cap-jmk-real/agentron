/**
 * GitHub API helpers (create issue). Used server-side only with token from github-settings.
 */

export type CreateIssueParams = {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  token: string;
};

export type CreateIssueResult = {
  issueUrl?: string;
  error?: string;
};

const TITLE_MAX = 256;
const BODY_MAX = 65535;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/**
 * Creates a GitHub issue. Returns issue URL or error.
 */
export async function createIssue(params: CreateIssueParams): Promise<CreateIssueResult> {
  const { owner, repo, title, body, labels, token } = params;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  const payload = {
    title: truncate(title, TITLE_MAX),
    body: truncate(body, BODY_MAX),
    ...(Array.isArray(labels) && labels.length > 0 ? { labels } : {}),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as {
    html_url?: string;
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    const err =
      data.message ||
      (Array.isArray(data.errors) && data.errors[0]?.message) ||
      res.statusText ||
      "GitHub API error";
    return { error: err };
  }
  const issueUrl = data.html_url;
  return issueUrl ? { issueUrl } : { error: "No issue URL in response" };
}
