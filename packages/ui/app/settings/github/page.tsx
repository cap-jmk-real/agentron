"use client";

import { useEffect, useState, useCallback } from "react";

type GitHubSettings = {
  enabled: boolean;
  hasToken: boolean;
  autoReportRunErrors: boolean;
  defaultRepoOwner?: string;
  defaultRepoName?: string;
  issueLabels?: string[];
};

const GITHUB_TOKEN_DOCS =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token";

export default function GitHubSettingsPage() {
  const [settings, setSettings] = useState<GitHubSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [useEnvVar, setUseEnvVar] = useState(false);
  const [envVarName, setEnvVarName] = useState("GITHUB_TOKEN");
  const [defaultRepoOwner, setDefaultRepoOwner] = useState("");
  const [defaultRepoName, setDefaultRepoName] = useState("");
  const [autoReportRunErrors, setAutoReportRunErrors] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [issueLabelsStr, setIssueLabelsStr] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/github");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setEnabled(data.enabled);
        setDefaultRepoOwner(data.defaultRepoOwner ?? "");
        setDefaultRepoName(data.defaultRepoName ?? "");
        setAutoReportRunErrors(data.autoReportRunErrors ?? false);
        setIssueLabelsStr(Array.isArray(data.issueLabels) ? data.issueLabels.join(", ") : "");
      }
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useEnvVar
            ? {
                owner: defaultRepoOwner.trim() || undefined,
                repo: defaultRepoName.trim() || undefined,
              }
            : {
                token: accessToken.trim() || undefined,
                owner: defaultRepoOwner.trim() || undefined,
                repo: defaultRepoName.trim() || undefined,
              }
        ),
      });
      const data = await res.json();
      setTestResult({ ok: data.ok === true, error: data.error });
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        enabled,
        autoReportRunErrors,
        defaultRepoOwner: defaultRepoOwner.trim() || undefined,
        defaultRepoName: defaultRepoName.trim() || undefined,
        issueLabels: issueLabelsStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (useEnvVar) {
        payload.accessTokenEnvVar = envVarName.trim() || undefined;
        payload.accessToken = undefined;
      } else if (accessToken.trim()) {
        payload.accessToken = accessToken.trim();
      }
      const res = await fetch("/api/settings/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || res.statusText);
        return;
      }
      setSettings(data);
      if (data.hasToken) setAccessToken("");
      setTestResult(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <div className="card" style={{ padding: "1rem" }}>
          <p style={{ color: "var(--text-muted)" }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>GitHub</h1>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          Connect a GitHub repo to auto-report workflow run errors as issues. Created issues include
          an &quot;Assisted coding by Agentron&quot; label and link.
        </p>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
            Personal Access Token
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Create a token with{" "}
            <code
              style={{
                background: "var(--surface-muted)",
                padding: "0.1rem 0.3rem",
                borderRadius: 4,
              }}
            >
              repo
            </code>{" "}
            scope (or{" "}
            <code
              style={{
                background: "var(--surface-muted)",
                padding: "0.1rem 0.3rem",
                borderRadius: 4,
              }}
            >
              public_repo
            </code>{" "}
            for public repos only).
          </p>
          <a
            href={GITHUB_TOKEN_DOCS}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.85rem", color: "var(--primary)" }}
          >
            GitHub: Create a personal access token →
          </a>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "0.75rem",
              marginBottom: "0.5rem",
              fontSize: "0.85rem",
            }}
          >
            <input
              type="checkbox"
              checked={useEnvVar}
              onChange={(e) => setUseEnvVar(e.target.checked)}
            />
            Use environment variable (token not stored on disk)
          </label>
          {useEnvVar ? (
            <input
              type="text"
              className="input"
              placeholder="e.g. GITHUB_TOKEN"
              value={envVarName}
              onChange={(e) => setEnvVarName(e.target.value)}
              style={{ width: "100%", maxWidth: 280 }}
            />
          ) : (
            <input
              type="password"
              className="input"
              placeholder={settings?.hasToken ? "•••••••• (already set)" : "Paste your token here"}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              style={{ width: "100%", maxWidth: 400 }}
            />
          )}
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
            Default repository
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Owner and repo name for auto-created issues (e.g.{" "}
            <code
              style={{
                background: "var(--surface-muted)",
                padding: "0.1rem 0.3rem",
                borderRadius: 4,
              }}
            >
              myorg
            </code>{" "}
            and{" "}
            <code
              style={{
                background: "var(--surface-muted)",
                padding: "0.1rem 0.3rem",
                borderRadius: 4,
              }}
            >
              myrepo
            </code>
            ).
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <input
              type="text"
              className="input"
              placeholder="Owner (org or user)"
              value={defaultRepoOwner}
              onChange={(e) => setDefaultRepoOwner(e.target.value)}
              style={{ width: "100%", maxWidth: 200 }}
            />
            <input
              type="text"
              className="input"
              placeholder="Repo name"
              value={defaultRepoName}
              onChange={(e) => setDefaultRepoName(e.target.value)}
              style={{ width: "100%", maxWidth: 200 }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <button
            type="button"
            className="button"
            onClick={handleTest}
            disabled={testing || (useEnvVar ? !envVarName.trim() : !accessToken.trim())}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {testResult && (
            <span
              style={{
                marginLeft: "0.75rem",
                fontSize: "0.85rem",
                color: testResult.ok ? "var(--success)" : "var(--resource-red)",
              }}
            >
              {testResult.ok ? "Connected" : testResult.error}
            </span>
          )}
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable GitHub integration
          </label>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}
          >
            <input
              type="checkbox"
              checked={autoReportRunErrors}
              onChange={(e) => setAutoReportRunErrors(e.target.checked)}
            />
            Auto-report run errors to GitHub Issues
          </label>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
            When a workflow run fails, create a GitHub issue in the default repo with the error
            details and a link to the run.
          </p>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
            Issue labels (optional)
          </div>
          <input
            type="text"
            className="input"
            placeholder="e.g. agentron, run-error"
            value={issueLabelsStr}
            onChange={(e) => setIssueLabelsStr(e.target.value)}
            style={{ width: "100%", maxWidth: 320 }}
          />
        </div>

        {saveError && (
          <p style={{ color: "var(--resource-red)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
            {saveError}
          </p>
        )}
        <button
          type="button"
          className="button button-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>

        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            marginTop: "1.25rem",
          }}
        >
          Created issues will include an &quot;Assisted coding by Agentron&quot; label and link. You
          can add a &quot;Built with Agentron&quot; badge to your repo README (see docs).
        </p>
      </div>
    </div>
  );
}
