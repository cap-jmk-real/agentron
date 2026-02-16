"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, MessageSquare, Server, Box, Check, ArrowRight } from "lucide-react";
import BrandIcon from "../components/brand-icon";

type SetupStatus = { vaultExists: boolean; hasLlmProvider: boolean };

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data: SetupStatus) => setStatus(data))
      .catch(() => setStatus({ vaultExists: false, hasLlmProvider: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading || status === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: "0.75rem" }}>
        <BrandIcon size={48} className="brand-logo" />
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading…</p>
      </div>
    );
  }

  // If vault exists, redirect to home (setup already done or user returning)
  if (status.vaultExists) {
    router.replace("/");
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: "0.75rem" }}>
        <BrandIcon size={48} className="brand-logo" />
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Redirecting…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{ marginBottom: "0.75rem" }}><BrandIcon size={56} className="brand-logo" /></div>
        <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem" }}>Welcome to Agentron Studio</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
          Set up your vault and add an LLM provider to get started.
        </p>
      </div>

      <div className="card" style={{ padding: "1.25rem" }}>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
          <li style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--primary)", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 600, flexShrink: 0 }}>1</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Lock size={18} /> Create vault (master password)
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.35rem 0 0.5rem", lineHeight: 1.5 }}>
                Your vault stores API keys and passwords for the chat agent. Set a master password to create it.
              </p>
              <Link href="/settings/vault" className="button button-small" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                Set up vault <ArrowRight size={14} />
              </Link>
            </div>
          </li>
          <li style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: status.hasLlmProvider ? "#22c55e" : "var(--surface-muted)", color: status.hasLlmProvider ? "white" : "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {status.hasLlmProvider ? <Check size={16} /> : "2"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MessageSquare size={18} /> Add an LLM provider
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.35rem 0 0.5rem", lineHeight: 1.5 }}>
                Connect OpenAI, Anthropic, Ollama, or another provider so the chat assistant can respond.
              </p>
              <Link href="/settings/llm" className="button button-ghost button-small" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                LLM Settings <ArrowRight size={14} />
              </Link>
            </div>
          </li>
          <li style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface-muted)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 600, flexShrink: 0 }}>3</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Server size={18} /> Install Ollama (optional)
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.35rem 0 0.5rem", lineHeight: 1.5 }}>
                Run models locally with Ollama. Install and add as an LLM provider for private, offline use.
              </p>
              <Link href="/settings/local" className="button button-ghost button-small" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                Local models &amp; Ollama <ArrowRight size={14} />
              </Link>
            </div>
          </li>
          <li style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface-muted)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 600, flexShrink: 0 }}>4</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Box size={18} /> Docker or Podman (optional)
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.35rem 0 0.5rem", lineHeight: 1.5 }}>
                For sandboxes and code execution, install Docker or Podman and choose the engine in settings.
              </p>
              <Link href="/settings/container" className="button button-ghost button-small" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                Container Engine <ArrowRight size={14} />
              </Link>
            </div>
          </li>
        </ol>
      </div>

      <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
        After creating your vault, you can <Link href="/" style={{ color: "var(--primary)" }}>go to the overview</Link> or open Chat from the sidebar.
      </p>
    </div>
  );
}
