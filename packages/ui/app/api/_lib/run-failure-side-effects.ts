/**
 * Centralized side effects when a run fails: notification + optional GitHub issue.
 * All code paths that set run status to "failed" should call ensureRunFailureSideEffects
 * instead of calling createRunNotification directly.
 */

import { eq } from "drizzle-orm";
import { db, executions } from "./db";
import { createRunNotification } from "./notifications-store";
import { getGitHubSettings, getGitHubAccessToken } from "./github-settings";
import { wasRunAlreadyReported, markRunAsReported } from "./github-reported-runs";
import { createIssue } from "./github-api";
import { logApiError } from "./api-logger";

const BRANDING_FOOTER =
  "\n\n---\n*Reported by [Agentron](https://agentron.dev) · [Assisted coding](https://agentron.dev/docs/assisted-coding).*";

/** Escape for use in markdown list item (avoid [ ] interpreted as link). */
function escapeInline(s: string): string {
  return s.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function buildIssueBody(runId: string, output: unknown, runLink?: string): string {
  const lines: string[] = [];
  lines.push(`**Run ID:** \`${runId}\``);
  if (runLink) lines.push(`**Link:** ${runLink}`);
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    const err = o.error;
    if (typeof err === "string" && err.trim()) {
      lines.push("");
      lines.push("## Error");
      lines.push("");
      lines.push("```");
      lines.push(err.trim().slice(0, 8000));
      lines.push("```");
    }
    const details = o.errorDetails as Record<string, unknown> | undefined;
    if (details && typeof details === "object" && typeof details.stack === "string") {
      lines.push("");
      lines.push("## Stack");
      lines.push("");
      lines.push("```");
      lines.push(details.stack.slice(0, 4000));
      lines.push("```");
    }
    const trail = o.trail as
      | Array<{ order?: number; nodeId?: string; agentName?: string; error?: string }>
      | undefined;
    if (Array.isArray(trail) && trail.length > 0) {
      lines.push("");
      lines.push("## Steps");
      lines.push("");
      for (const s of trail.slice(-20)) {
        const name = [s.agentName, s.nodeId].filter(Boolean).join(" · ") || "step";
        const errPart =
          typeof s.error === "string" && s.error.trim()
            ? ` — *${escapeInline(s.error.slice(0, 200))}*`
            : "";
        lines.push(`- ${name}${errPart}`);
      }
    }
  }
  lines.push(BRANDING_FOOTER);
  return lines.join("\n");
}

function buildIssueTitle(output: unknown): string {
  const prefix = "[Agentron] Run failed: ";
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const err = (output as Record<string, unknown>).error;
    if (typeof err === "string" && err.trim()) {
      const oneLine = err.replace(/\s+/g, " ").trim().slice(0, 200);
      return prefix + oneLine;
    }
  }
  return prefix + "Workflow execution failed";
}

export type RunFailureMetadata = {
  targetType?: string;
  targetId?: string;
};

/**
 * Creates the run notification and, if GitHub auto-report is enabled, creates a GitHub issue
 * (debounced by run id). Does not throw; logs errors. Call after updating run status to "failed".
 */
export async function ensureRunFailureSideEffects(
  runId: string,
  metadata?: RunFailureMetadata
): Promise<void> {
  try {
    await createRunNotification(runId, "failed", metadata);
  } catch (e) {
    logApiError("run-failure-side-effects", "createRunNotification", e);
  }

  const gh = getGitHubSettings();
  const owner = gh.defaultRepoOwner;
  const repo = gh.defaultRepoName;
  if (!gh.autoReportRunErrors || !gh.hasToken || !owner || !repo) {
    return;
  }
  if (wasRunAlreadyReported(runId)) {
    return;
  }

  const token = getGitHubAccessToken();
  if (!token) return;

  void (async () => {
    try {
      const rows = await db
        .select({ output: executions.output })
        .from(executions)
        .where(eq(executions.id, runId));
      if (rows.length === 0) return;
      const rawOutput = rows[0].output;
      const output =
        typeof rawOutput === "string"
          ? (() => {
              try {
                return JSON.parse(rawOutput) as unknown;
              } catch {
                return rawOutput;
              }
            })()
          : rawOutput;

      const baseUrl = process.env.AGENTRON_BASE_URL?.trim() || "";
      const runLink = baseUrl ? `${baseUrl.replace(/\/$/, "")}/runs/${runId}` : undefined;
      const title = buildIssueTitle(output);
      const body = buildIssueBody(runId, output, runLink);
      const labels = gh.issueLabels?.length ? gh.issueLabels : ["agentron", "run-error"];

      const result = await createIssue({
        owner,
        repo,
        title,
        body,
        labels,
        token,
      });

      if (result.error) {
        logApiError("run-failure-side-effects", "createIssue", new Error(result.error));
        return;
      }
      markRunAsReported(runId);
    } catch (e) {
      logApiError("run-failure-side-effects", "github-issue", e);
    }
  })();
}
