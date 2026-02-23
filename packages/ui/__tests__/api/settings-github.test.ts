import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, PATCH } from "../../app/api/settings/github/route";
import { POST as testPost, __setFetchForTest } from "../../app/api/settings/github/test/route";
import * as githubSettings from "../../app/api/_lib/github-settings";

describe("Settings GitHub API", () => {
  afterEach(() => {
    __setFetchForTest(null);
  });

  beforeEach(async () => {
    await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          autoReportRunErrors: false,
          accessToken: "",
          defaultRepoOwner: "",
          defaultRepoName: "",
        }),
      })
    );
  });

  it("GET /api/settings/github returns 500 when getGitHubSettings throws", async () => {
    vi.spyOn(githubSettings, "getGitHubSettings").mockImplementationOnce(() => {
      throw new Error("read fail");
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("read fail");
    vi.restoreAllMocks();
  });

  it("GET /api/settings/github returns 500 with generic message when thrown value is not Error", async () => {
    vi.spyOn(githubSettings, "getGitHubSettings").mockImplementationOnce(() => {
      throw "string error";
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to load GitHub settings");
    vi.restoreAllMocks();
  });

  it("GET /api/settings/github returns shape without token", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.enabled).toBe("boolean");
    expect(typeof data.hasToken).toBe("boolean");
    expect(typeof data.autoReportRunErrors).toBe("boolean");
    expect(data).not.toHaveProperty("accessToken");
  });

  it("PATCH /api/settings/github updates enabled and autoReportRunErrors", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          autoReportRunErrors: true,
          defaultRepoOwner: "myorg",
          defaultRepoName: "myrepo",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.autoReportRunErrors).toBe(true);
    expect(data.defaultRepoOwner).toBe("myorg");
    expect(data.defaultRepoName).toBe("myrepo");
  });

  it("PATCH /api/settings/github with accessToken sets hasToken", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: "ghp_test123" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasToken).toBe(true);
    expect(data).not.toHaveProperty("accessToken");
  });

  it("PATCH /api/settings/github with accessTokenEnvVar clears token", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessTokenEnvVar: "GITHUB_TOKEN" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).not.toHaveProperty("accessToken");
  });

  it("PATCH /api/settings/github with issueLabels filters to strings", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueLabels: ["agentron", "run-error", 1, null] }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issueLabels).toEqual(["agentron", "run-error"]);
  });

  it("PATCH /api/settings/github returns 500 when updateGitHubSettings throws", async () => {
    vi.spyOn(githubSettings, "updateGitHubSettings").mockImplementationOnce(() => {
      throw new Error("write fail");
    });
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("write fail");
    vi.restoreAllMocks();
  });

  it("PATCH /api/settings/github returns 500 with generic message when thrown value is not Error", async () => {
    vi.spyOn(githubSettings, "updateGitHubSettings").mockImplementationOnce(() => {
      throw "not an Error";
    });
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to update GitHub settings");
    vi.restoreAllMocks();
  });

  it("PATCH /api/settings/github with invalid JSON body uses empty payload", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.enabled).toBe("boolean");
  });

  it("POST /api/settings/github/test returns 400 when no token", async () => {
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No token");
  });

  it("POST /api/settings/github/test with valid mock returns ok", async () => {
    vi.spyOn(githubSettings, "getGitHubAccessToken").mockReturnValueOnce("ghp_mock");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    __setFetchForTest(fetchMock);
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_mock" }),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("POST /api/settings/github/test uses saved token when body has no token", async () => {
    vi.spyOn(githubSettings, "getGitHubAccessToken").mockReturnValueOnce("ghp_saved");
    __setFetchForTest(vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("POST /api/settings/github/test returns ok false when GitHub user API returns not ok", async () => {
    __setFetchForTest(
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Unauthorized",
        json: async () => ({ message: "Bad credentials" }),
      })
    );
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_bad" }),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Bad credentials");
  });

  it("POST /api/settings/github/test uses statusText when errBody has no message", async () => {
    __setFetchForTest(
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Forbidden",
        json: async () => ({}),
      })
    );
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_x" }),
      })
    );
    vi.restoreAllMocks();
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("POST /api/settings/github/test uses statusText when res.json() throws", async () => {
    __setFetchForTest(
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("parse error");
        },
      })
    );
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_x" }),
      })
    );
    vi.restoreAllMocks();
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Bad Gateway");
  });

  it("POST /api/settings/github/test uses GitHub API error when not ok and errBody has no message and statusText empty", async () => {
    __setFetchForTest(
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "",
        json: async () => ({}),
      })
    );
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_x" }),
      })
    );
    vi.restoreAllMocks();
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("GitHub API error");
  });

  it("POST /api/settings/github/test with owner and repo checks repo access and returns ok", async () => {
    __setFetchForTest(
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    );
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_ok", owner: "myorg", repo: "myrepo" }),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("POST /api/settings/github/test with owner and repo returns ok false when repo not found", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
        json: async () => ({ message: "Not Found" }),
      });
    __setFetchForTest(fetchMock);
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_ok", owner: "x", repo: "nonexistent" }),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Not Found");
  });

  it("POST /api/settings/github/test repo error uses statusText when errBody has no message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, statusText: "404", json: async () => ({}) });
    __setFetchForTest(fetchMock);
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_ok", owner: "o", repo: "r" }),
      })
    );
    vi.restoreAllMocks();
    const data = await res.json();
    expect(data.error).toBe("404");
  });

  it("POST /api/settings/github/test repo error uses Repo not found when repoRes.json throws", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: false,
        statusText: "",
        json: async () => {
          throw new Error("parse");
        },
      });
    __setFetchForTest(fetchMock);
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_ok", owner: "o", repo: "r" }),
      })
    );
    vi.restoreAllMocks();
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Repo not found");
  });

  it("POST /api/settings/github/test with invalid JSON body uses empty body and returns 400 when no token", async () => {
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json {{{",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No token");
  });

  it("POST /api/settings/github/test returns 500 when fetch throws", async () => {
    __setFetchForTest(vi.fn().mockRejectedValue(new Error("network error")));
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_x" }),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("network error");
  });

  it("POST /api/settings/github/test returns 500 with generic message when thrown value is not Error", async () => {
    __setFetchForTest(vi.fn().mockRejectedValue("string throw"));
    const res = await testPost(
      new Request("http://localhost/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_x" }),
      })
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Test failed");
  });
});
