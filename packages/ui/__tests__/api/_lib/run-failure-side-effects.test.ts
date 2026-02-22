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

vi.mock("../../../app/api/_lib/github-api", () => ({
  createIssue: vi.fn().mockResolvedValue({ issueUrl: "https://github.com/o/r/issues/1" }),
}));

import { ensureRunFailureSideEffects } from "../../../app/api/_lib/run-failure-side-effects";

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
});
