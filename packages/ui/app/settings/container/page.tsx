"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ContainerEngine = "podman" | "docker";

export default function ContainerEngineSettingsPage() {
  const [containerEngine, setContainerEngine] = useState<ContainerEngine>("podman");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/app")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { containerEngine?: ContainerEngine } | null) => {
        if (data?.containerEngine === "docker" || data?.containerEngine === "podman") {
          setContainerEngine(data.containerEngine);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerEngine }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.containerEngine) setContainerEngine(data.containerEngine);
      }
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
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Container Engine</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1.5rem" }}>
        Choose which container runtime to use for sandboxes and code execution. Ensure the selected engine is installed and running (e.g. <code>podman info</code> or <code>docker info</code>).
      </p>

      <div className="card" style={{ padding: "1rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Engine</div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
          Podman is rootless by default; Docker requires the Docker daemon. Both use the same container images.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <select
            value={containerEngine}
            onChange={(e) => setContainerEngine(e.target.value as ContainerEngine)}
            style={{ padding: "0.35rem 0.5rem", fontSize: "0.9rem", minWidth: 140 }}
          >
            <option value="podman">Podman</option>
            <option value="docker">Docker</option>
          </select>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <p style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
        <Link href="/settings" style={{ color: "var(--primary)" }}>← General settings</Link>
      </p>
    </div>
  );
}
