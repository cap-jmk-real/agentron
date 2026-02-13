"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type TelegramSettings = {
  enabled: boolean;
  hasToken: boolean;
  notificationChatId?: string;
  botUsername?: string;
};

const BOTFATHER_URL = "https://t.me/BotFather";

/** Webhook URL for the current origin (so Telegram can POST updates to this app). */
function getWebhookUrl(): string {
  if (typeof window === "undefined") return "https://your-domain.com/api/telegram/webhook";
  return `${window.location.origin}/api/telegram/webhook`;
}

export default function TelegramSettingsPage() {
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [useEnvVar, setUseEnvVar] = useState(false);
  const [envVarName, setEnvVarName] = useState("TELEGRAM_BOT_TOKEN");
  const [notificationChatId, setNotificationChatId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; username?: string; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/telegram");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setEnabled(data.enabled);
        setNotificationChatId(data.notificationChatId ?? "");
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
      const res = await fetch("/api/settings/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useEnvVar ? {} : { token: botToken }),
      });
      const data = await res.json();
      setTestResult({ ok: data.ok, username: data.username, error: data.error });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
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
        notificationChatId: notificationChatId.trim() || undefined,
      };
      if (useEnvVar) {
        payload.botTokenEnvVar = envVarName.trim() || undefined;
        payload.botToken = undefined;
      } else if (botToken.trim()) {
        payload.botToken = botToken.trim();
      }
      const res = await fetch("/api/settings/telegram", {
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
      if (data.hasToken) {
        setBotToken("");
      }
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
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Telegram</h1>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          Use Telegram to delegate tasks and reply when Agentron needs your input. Same as the in-app chat, from your phone or desktop.
        </p>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>Step 1: Create a bot</div>
          <ol style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0 1.25rem", padding: 0 }}>
            <li>Open Telegram and search for <strong>@BotFather</strong>.</li>
            <li>Send <code style={{ background: "var(--bg-muted)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>/newbot</code>.</li>
            <li>Choose a name and a username (e.g. MyAgentronBot).</li>
            <li>Copy the token BotFather sends you.</li>
          </ol>
          <a href={BOTFATHER_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>
            Open @BotFather in Telegram →
          </a>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>Step 2: Bot token</div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
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
              placeholder="e.g. TELEGRAM_BOT_TOKEN"
              value={envVarName}
              onChange={(e) => setEnvVarName(e.target.value)}
              style={{ width: "100%", maxWidth: 280 }}
            />
          ) : (
            <input
              type="password"
              className="input"
              placeholder={settings?.hasToken ? "•••••••• (already set)" : "Paste your bot token here"}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              style={{ width: "100%", maxWidth: 400 }}
            />
          )}
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <button
            type="button"
            className="button"
            onClick={handleTest}
            disabled={testing || (useEnvVar ? !envVarName.trim() : !botToken.trim())}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {testResult && (
            <span style={{ marginLeft: "0.75rem", fontSize: "0.85rem", color: testResult.ok ? "var(--success)" : "var(--danger)" }}>
              {testResult.ok ? `Connected as ${testResult.username ?? "bot"}` : testResult.error}
            </span>
          )}
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>Step 3: Set webhook URL</div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            So Telegram can deliver messages to this app, set your bot&apos;s webhook to the URL below. In Telegram, send <code style={{ background: "var(--bg-muted)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>/setwebhook</code> to @BotFather, then paste the URL. If your app is not reachable from the internet (e.g. localhost), use a tunnel (ngrok, Cloudflare Tunnel) and use that public URL when opening this page.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <code style={{ fontSize: "0.8rem", background: "var(--bg-muted)", padding: "0.35rem 0.5rem", borderRadius: 4, wordBreak: "break-all" }}>
              {getWebhookUrl()}
            </code>
            <button
              type="button"
              className="button"
              style={{ fontSize: "0.8rem" }}
              onClick={() => navigator.clipboard?.writeText(getWebhookUrl())}
            >
              Copy
            </button>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            Optional: set <code style={{ background: "var(--bg-muted)", padding: "0.1rem 0.2rem", borderRadius: 2 }}>TELEGRAM_WEBHOOK_SECRET</code> in your environment and add <code style={{ background: "var(--bg-muted)", padding: "0.1rem 0.2rem", borderRadius: 2 }}>?secret=YOUR_SECRET</code> to the webhook URL so only Telegram (with that secret in the URL) can call it.
          </p>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable Telegram (bot will accept messages when running)
          </label>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>Notification chat ID (optional)</div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            When a run needs your input, the bot can send the question to this chat. Send any message to your bot (e.g. /start), then use a tool like @userinfobot to get your chat ID and paste it here.
          </p>
          <input
            type="text"
            className="input"
            placeholder="e.g. 123456789"
            value={notificationChatId}
            onChange={(e) => setNotificationChatId(e.target.value)}
            style={{ width: "100%", maxWidth: 200 }}
          />
        </div>

        {saveError && (
          <p style={{ fontSize: "0.85rem", color: "var(--danger)", marginBottom: "0.75rem" }}>{saveError}</p>
        )}
        <button type="button" className="button primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
        <Link href="/settings" style={{ color: "var(--primary)" }}>← General settings</Link>
      </p>
    </div>
  );
}
