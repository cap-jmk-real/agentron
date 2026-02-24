import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateRunNotification = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../app/api/_lib/notifications-store", () => ({
  createRunNotification: (...args: unknown[]) => mockCreateRunNotification(...args),
}));

const mockGetGitHubSettings = vi.fn().mockReturnValue({
  autoReportRunErrors: false,
  hasToken: false,
  defaultRepoOwner: undefined,
  defaultRepoName: undefined,
  issueLabels: undefined,
});
const mockGetGitHubAccessToken = vi.fn().mockReturnValue(undefined);

vi.mock("../../../app/api/_lib/github-settings", () => ({
  getGitHubSettings: (...args: unknown[]) => mockGetGitHubSettings(...args),
  getGitHubAccessToken: (...args: unknown[]) => mockGetGitHubAccessToken(...args),
}));

const mockWasRunAlreadyReported = vi.fn().mockReturnValue(false);
const mockMarkRunAsReported = vi.fn();

vi.mock("../../../app/api/_lib/github-reported-runs", () => ({
  wasRunAlreadyReported: (...args: unknown[]) => mockWasRunAlreadyReported(...args),
  markRunAsReported: (...args: unknown[]) => mockMarkRunAsReported(...args),
}));

const mockCreateIssue = vi.fn().mockResolvedValue({ issueUrl: "https://github.com/o/r/issues/1" });
vi.mock("../../../app/api/_lib/github-api", () => ({
  createIssue: (...args: unknown[]) => mockCreateIssue(...args),
}));

import { ensureRunFailureSideEffects } from "../../../app/api/_lib/run-failure-side-effects";
import { db, executions, toExecutionRow } from "../../../app/api/_lib/db";
import { eq } from "drizzle-orm";

describe("run-failure-side-effects", () => {
  beforeEach(() => {
    mockCreateRunNotification.mockClear();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: false,
      hasToken: false,
      defaultRepoOwner: undefined,
      defaultRepoName: undefined,
      issueLabels: undefined,
    });
    mockGetGitHubAccessToken.mockReturnValue(undefined);
    mockWasRunAlreadyReported.mockReturnValue(false);
    mockMarkRunAsReported.mockClear();
  });

  it("calls createRunNotification with failed and metadata", async () => {
    await ensureRunFailureSideEffects("run-1", {
      targetType: "workflow",
      targetId: "wf-1",
    });
    expect(mockCreateRunNotification).toHaveBeenCalledWith("run-1", "failed", {
      targetType: "workflow",
      targetId: "wf-1",
    });
  });

  it("does not throw when createRunNotification throws", async () => {
    mockCreateRunNotification.mockRejectedValueOnce(new Error("notification fail"));
    await expect(
      ensureRunFailureSideEffects("run-1", { targetType: "workflow", targetId: "w" })
    ).resolves.toBeUndefined();
  });

  it("skips GitHub issue when autoReportRunErrors is false", async () => {
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: false,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    await ensureRunFailureSideEffects("run-1");
    await new Promise((r) => setImmediate(r));
    expect(mockMarkRunAsReported).not.toHaveBeenCalled();
  });

  it("skips GitHub issue when run was already reported", async () => {
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockWasRunAlreadyReported.mockReturnValueOnce(true);
    await ensureRunFailureSideEffects("run-1");
    await new Promise((r) => setImmediate(r));
    expect(mockMarkRunAsReported).not.toHaveBeenCalled();
  });

  it("skips GitHub issue when owner or repo missing", async () => {
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: undefined,
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    await ensureRunFailureSideEffects("run-1");
    await new Promise((r) => setImmediate(r));
    expect(mockMarkRunAsReported).not.toHaveBeenCalled();
  });

  it("skips GitHub issue when getGitHubAccessToken returns undefined", async () => {
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue(undefined);
    await ensureRunFailureSideEffects("run-1");
    await new Promise((r) => setImmediate(r));
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("creates GitHub issue and marks run as reported when auto-report enabled and run has output", async () => {
    const runId = "run-gh-issue-" + Date.now();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "failed",
          output: {
            error: "Workflow execution failed",
            trail: [{ agentName: "Step1", nodeId: "n1", error: "Step error" }],
          },
        })
      )
      .run();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "owner",
      defaultRepoName: "repo",
      issueLabels: ["agentron", "run-error"],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockCreateIssue.mockResolvedValueOnce({ issueUrl: "https://github.com/owner/repo/issues/1" });
    await ensureRunFailureSideEffects(runId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        title: expect.stringContaining("Run failed"),
        body: expect.stringContaining(runId),
        labels: ["agentron", "run-error"],
      })
    );
    expect(mockMarkRunAsReported).toHaveBeenCalledWith(runId);
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });

  it("does not mark run as reported when createIssue returns error", async () => {
    const runId = "run-gh-error-" + Date.now();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "failed",
          output: { error: "Failed" },
        })
      )
      .run();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockCreateIssue.mockResolvedValueOnce({ error: "API rate limit" });
    await ensureRunFailureSideEffects(runId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockMarkRunAsReported).not.toHaveBeenCalled();
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });

  it("uses raw output string when execution output is non-JSON string (parse catch branch)", async () => {
    const runId = "run-raw-output-" + Date.now();
    const row = toExecutionRow({
      id: runId,
      targetType: "workflow",
      targetId: "wf-1",
      status: "failed",
      output: { error: "x" },
    });
    await db
      .insert(executions)
      .values({ ...row, output: "plain text not json" })
      .run();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockCreateIssue.mockResolvedValueOnce({ issueUrl: "https://github.com/o/r/issues/2" });
    await ensureRunFailureSideEffects(runId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 100));
    expect(mockCreateIssue).toHaveBeenCalled();
    const call = mockCreateIssue.mock.calls[mockCreateIssue.mock.calls.length - 1];
    expect(call[0].title).toContain("Workflow execution failed");
    expect(call[0].body).toContain(runId);
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });

  it("uses default issue title when output has no error string", async () => {
    const runId = "run-no-err-" + Date.now();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "failed",
          output: {},
        })
      )
      .run();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockCreateIssue.mockResolvedValueOnce({ issueUrl: "https://github.com/o/r/issues/3" });
    await ensureRunFailureSideEffects(runId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateIssue).toHaveBeenCalled();
    const call = mockCreateIssue.mock.calls[mockCreateIssue.mock.calls.length - 1];
    expect(call[0].title).toBe("[Agentron] Run failed: Workflow execution failed");
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });

  it("buildIssueBody includes Stack section when output has errorDetails.stack", async () => {
    const runId = "run-stack-" + Date.now();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "failed",
          output: {
            error: "Something broke",
            errorDetails: { stack: "Error: Something broke\n  at fn (file.ts:10:5)" },
          },
        })
      )
      .run();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockCreateIssue.mockResolvedValueOnce({ issueUrl: "https://github.com/o/r/issues/6" });
    await ensureRunFailureSideEffects(runId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateIssue).toHaveBeenCalled();
    const call = mockCreateIssue.mock.calls[mockCreateIssue.mock.calls.length - 1];
    expect(call[0].body).toContain("## Stack");
    expect(call[0].body).toContain("at fn (file.ts:10:5)");
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });

  it("buildIssueBody includes step name without error part when trail item error is not string", async () => {
    const runId = "run-trail-nostring-" + Date.now();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "failed",
          output: {
            error: "Failed",
            trail: [{ agentName: "Step1", nodeId: "n1", error: 123 as unknown as string }],
          },
        })
      )
      .run();
    mockGetGitHubSettings.mockReturnValue({
      autoReportRunErrors: true,
      hasToken: true,
      defaultRepoOwner: "o",
      defaultRepoName: "r",
      issueLabels: [],
    });
    mockGetGitHubAccessToken.mockReturnValue("token");
    mockCreateIssue.mockResolvedValueOnce({ issueUrl: "https://github.com/o/r/issues/5" });
    await ensureRunFailureSideEffects(runId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateIssue).toHaveBeenCalled();
    const call = mockCreateIssue.mock.calls[mockCreateIssue.mock.calls.length - 1];
    expect(call[0].body).toContain("## Steps");
    expect(call[0].body).toContain("Step1");
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });

  it("issue body omits run link when AGENTRON_BASE_URL is not set", async () => {
    const runId = "run-no-base-url-" + Date.now();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: "wf-1",
          status: "failed",
          output: { error: "err" },
        })
      )
      .run();
    const saved = process.env.AGENTRON_BASE_URL;
    delete process.env.AGENTRON_BASE_URL;
    try {
      mockGetGitHubSettings.mockReturnValue({
        autoReportRunErrors: true,
        hasToken: true,
        defaultRepoOwner: "o",
        defaultRepoName: "r",
        issueLabels: [],
      });
      mockGetGitHubAccessToken.mockReturnValue("token");
      mockCreateIssue.mockResolvedValueOnce({ issueUrl: "https://github.com/o/r/issues/4" });
      await ensureRunFailureSideEffects(runId);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));
      expect(mockCreateIssue).toHaveBeenCalled();
      const call = mockCreateIssue.mock.calls[mockCreateIssue.mock.calls.length - 1];
      expect(call[0].body).toContain("**Run ID:**");
      expect(call[0].body).not.toContain("**Link:**");
    } finally {
      if (saved !== undefined) process.env.AGENTRON_BASE_URL = saved;
    }
    await db.delete(executions).where(eq(executions.id, runId)).run();
  });
});
