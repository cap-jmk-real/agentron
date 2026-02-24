"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Terminal, Box, ChevronRight } from "lucide-react";

type Sandbox = {
  id: string;
  name: string;
  image: string;
  status: string;
  containerId?: string;
  createdAt: number;
};

export default function SandboxesPage() {
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox", { cache: "no-store" });
      const data = await res.json();
      setSandboxes(Array.isArray(data) ? data : []);
    } catch {
      setSandboxes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading sandboxes…</div>;
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 960 }}>
      <h1 style={{ margin: "0 0 1rem", fontSize: "1.5rem" }}>Sandboxes</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        Podman/Docker containers for code execution. Open a terminal to interact with a running
        sandbox.
      </p>

      {sandboxes.length === 0 ? (
        <div
          className="card"
          style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}
        >
          <Box size={40} style={{ margin: "0 auto 0.75rem", opacity: 0.5 }} />
          <p style={{ margin: 0 }}>No sandboxes yet.</p>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
            Create one from Agentron chat (e.g. &quot;create a podman sandbox with ubuntu&quot;) or
            via the API.
          </p>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {sandboxes.map((sb) => (
            <li key={sb.id}>
              <div
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{sb.name}</div>
                  <div
                    style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}
                  >
                    {sb.image} · {sb.status}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {sb.status === "running" && (
                    <Link
                      href={`/sandboxes/${sb.id}`}
                      className="button button-small"
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                    >
                      <Terminal size={14} />
                      Open terminal
                      <ChevronRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
