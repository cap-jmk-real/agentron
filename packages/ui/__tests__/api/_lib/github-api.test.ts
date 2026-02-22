import { describe, it, expect, vi, afterEach } from "vitest";
import { createIssue } from "../../../app/api/_lib/github-api";

describe("github-api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createIssue returns issueUrl on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: "https://github.com/o/r/issues/1" }),
      })
    );
    const result = await createIssue({
      owner: "o",
      repo: "r",
      title: "Test",
      body: "Body",
      token: "ghp_x",
    });
    expect(result.issueUrl).toBe("https://github.com/o/r/issues/1");
    expect(result.error).toBeUndefined();
  });

  it("createIssue returns error on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "Not Found" }),
      })
    );
    const result = await createIssue({
      owner: "o",
      repo: "r",
      title: "Test",
      body: "Body",
      token: "ghp_x",
    });
    expect(result.error).toBe("Not Found");
    expect(result.issueUrl).toBeUndefined();
  });

  it("createIssue truncates title and body", async () => {
    const captured: { title?: string; body?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const payload = init?.body ? JSON.parse(init.body as string) : {};
        captured.title = payload.title;
        captured.body = payload.body;
        return Promise.resolve({
          ok: true,
          json: async () => ({ html_url: "https://github.com/o/r/issues/1" }),
        });
      })
    );
    const longTitle = "a".repeat(300);
    const longBody = "b".repeat(70000);
    await createIssue({
      owner: "o",
      repo: "r",
      title: longTitle,
      body: longBody,
      token: "ghp_x",
    });
    expect(captured.title!.length).toBeLessThanOrEqual(256);
    expect(captured.body!.length).toBeLessThanOrEqual(65535);
  });

  it("createIssue sends labels when provided", async () => {
    let capturedPayload: { labels?: string[] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedPayload = init?.body ? JSON.parse(init.body as string) : {};
        return Promise.resolve({
          ok: true,
          json: async () => ({ html_url: "https://github.com/o/r/issues/1" }),
        });
      })
    );
    await createIssue({
      owner: "o",
      repo: "r",
      title: "T",
      body: "B",
      labels: ["agentron", "run-error"],
      token: "ghp_x",
    });
    expect(capturedPayload!.labels).toEqual(["agentron", "run-error"]);
  });

  it("createIssue returns error from data.errors when message absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({ errors: [{ message: "Validation failed" }] }),
      })
    );
    const result = await createIssue({
      owner: "o",
      repo: "r",
      title: "T",
      body: "B",
      token: "ghp_x",
    });
    expect(result.error).toBe("Validation failed");
  });

  it("createIssue returns statusText when message and errors absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Forbidden",
        json: async () => ({}),
      })
    );
    const result = await createIssue({
      owner: "o",
      repo: "r",
      title: "T",
      body: "B",
      token: "ghp_x",
    });
    expect(result.error).toBe("Forbidden");
  });

  it("createIssue returns default error when message, errors and statusText empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "",
        json: async () => ({}),
      })
    );
    const result = await createIssue({
      owner: "o",
      repo: "r",
      title: "T",
      body: "B",
      token: "ghp_x",
    });
    expect(result.error).toBe("GitHub API error");
  });

  it("createIssue returns error when res.ok but no html_url in response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })
    );
    const result = await createIssue({
      owner: "o",
      repo: "r",
      title: "T",
      body: "B",
      token: "ghp_x",
    });
    expect(result.error).toBe("No issue URL in response");
    expect(result.issueUrl).toBeUndefined();
  });
});
