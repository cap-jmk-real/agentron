export const runtime = "nodejs";

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/cap-jmk-real/agentron/releases/latest";

/** Parse "1.2.3" or "v1.2.3" into [major, minor, patch] or null. */
function parseSemver(version: string): [number, number, number] | null {
  const s = version.replace(/^v/i, "").trim();
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** True if a > b. */
function semverGt(a: string, b: string): boolean {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return false;
  if (va[0] !== vb[0]) return va[0] > vb[0];
  if (va[1] !== vb[1]) return va[1] > vb[1];
  return va[2] > vb[2];
}

/** GET: compare current app version with GitHub latest release. Returns { available, version?, url?, releaseNotes? } when update available. */
export async function GET() {
  const current =
    process.env.AGENTRON_APP_VERSION ??
    process.env.npm_package_version ??
    "";

  if (!current) {
    return json({ available: false });
  }

  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return json({ available: false });
    }
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string | null;
    };
    const tag = data.tag_name;
    if (!tag || typeof tag !== "string") {
      return json({ available: false });
    }
    const latest = tag.replace(/^v/i, "").trim();
    if (!semverGt(latest, current)) {
      return json({ available: false });
    }
    return json({
      available: true,
      version: latest,
      url: data.html_url ?? `https://github.com/cap-jmk-real/agentron/releases/tag/${tag}`,
      releaseNotes: data.body ?? undefined,
    });
  } catch {
    return json({ available: false });
  }
}
