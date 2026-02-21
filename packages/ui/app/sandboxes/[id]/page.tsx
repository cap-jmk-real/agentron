"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SandboxTerminal } from "../../components/sandbox-terminal";

type Sandbox = {
  id: string;
  name: string;
  image: string;
  status: string;
  containerId?: string;
};

export default function SandboxShellPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    let cancelled = false;
    fetch(`/api/sandbox/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSandbox(data);
      })
      .catch(() => {
        if (!cancelled) setSandbox(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "var(--text-muted)" }}>Missing sandbox id.</p>
        <Link
          href="/sandboxes"
          className="button button-small"
          style={{
            marginTop: "0.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          <ArrowLeft size={14} /> Back to sandboxes
        </Link>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading…</div>;
  }

  if (!sandbox) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "var(--resource-red)" }}>Sandbox not found.</p>
        <Link
          href="/sandboxes"
          className="button button-small"
          style={{
            marginTop: "0.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          <ArrowLeft size={14} /> Back to sandboxes
        </Link>
      </div>
    );
  }

  if (sandbox.status !== "running" || !sandbox.containerId) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "var(--text-muted)" }}>
          Sandbox is not running. Start it first from the sandbox list or chat.
        </p>
        <Link
          href="/sandboxes"
          className="button button-small"
          style={{
            marginTop: "0.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          <ArrowLeft size={14} /> Back to sandboxes
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - var(--topbar-height, 56px))",
        padding: "0 1rem 1rem",
      }}
    >
      <div
        style={{
          padding: "0.5rem 0",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexShrink: 0,
        }}
      >
        <Link
          href="/sandboxes"
          className="button button-small"
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
        >
          <ArrowLeft size={14} /> Sandboxes
        </Link>
        <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Terminal · {sandbox.name}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <SandboxTerminal
          sandboxId={sandbox.id}
          sandboxName={sandbox.name}
          className="sandbox-terminal-fill"
        />
      </div>
    </div>
  );
}
