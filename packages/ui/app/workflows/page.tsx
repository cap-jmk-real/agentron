"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Workflow as WorkflowIcon, ChevronRight, Trash2, Download, Play } from "lucide-react";
import ConfirmModal from "../components/confirm-modal";

type Workflow = {
  id: string;
  name: string;
  executionMode: string;
  schedule?: string;
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatSchedule(executionMode: string, schedule?: string): string {
  if (executionMode !== "interval" || !schedule?.trim()) return executionMode;
  const s = schedule.trim();
  if (s.startsWith("daily@")) return "Daily at " + (s.slice(6) || "09:00");
  if (s.startsWith("weekly@")) {
    const days = s.slice(7).split(",").map((d) => WEEKDAY_NAMES[parseInt(d, 10)] ?? d).filter(Boolean);
    return days.length ? "Weekly " + days.join(", ") : "Weekly";
  }
  if (s.startsWith("monthly@")) {
    const days = s.slice(8).split(",").filter(Boolean);
    return days.length ? "Monthly (day " + days.join(", ") + ")" : "Monthly";
  }
  const sec = parseInt(s, 10);
  if (Number.isNaN(sec)) return "interval";
  if (sec < 60) return "Every " + sec + "s";
  if (sec === 86400) return "Daily";
  if (sec === 604800) return "Weekly";
  if (sec === 2592000) return "Monthly";
  if (sec % 3600 === 0) return "Every " + sec / 3600 + "h";
  return "Every " + sec / 60 + " min";
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [workflowToDelete, setWorkflowToDelete] = useState<Workflow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/workflows");
    const data = await response.json();
    setWorkflows(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    void load();
  }, []);

  const createWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        nodes: [],
        edges: [],
        executionMode: "one_time"
      })
    });
    setName("");
    await load();
  };

  const onConfirmDelete = async () => {
    if (!workflowToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflows/${workflowToDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        setWorkflowToDelete(null);
        await load();
      }
    } finally {
      setDeleting(false);
    }
  };

  const selectedCount = selectedIds.size;
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === workflows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(workflows.map((w) => w.id)));
  };
  const onConfirmBulkDelete = async () => {
    if (selectedCount === 0) return;
    setBulkDeleting(true);
    try {
      for (const id of selectedIds) {
        await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      }
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      await load();
    } finally {
      setBulkDeleting(false);
    }
  };

  const executeWorkflow = async (workflowId: string) => {
    setExecutingId(workflowId);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/execute`, { method: "POST" });
      const data = res.ok ? await res.json() : null;
      if (data?.id) {
        router.push(`/runs/${data.id}`);
      }
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Workflows</h1>
        <a
          href="/api/export?type=workflows"
          className="button button-ghost button-small"
          style={{ flexShrink: 0 }}
          onClick={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/export?type=workflows");
            if (!res.ok) return;
            const blob = await res.blob();
            const disposition = res.headers.get("Content-Disposition");
            const name = disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? `agentron-workflows-${new Date().toISOString().slice(0, 10)}.json`;
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download size={14} /> Export JSON
        </a>
      </div>
      <div className="card" style={{ marginTop: "0.5rem" }}>
        <form onSubmit={createWorkflow} className="form">
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              placeholder="Workflow name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label>Execution Mode</label>
            <select className="select" defaultValue="one_time">
              <option value="one_time">one_time</option>
              <option value="continuous">continuous</option>
              <option value="interval">interval</option>
            </select>
          </div>
          <button type="submit" className="button">
            Create Workflow
          </button>
        </form>
      </div>
      {workflows.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.875rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={workflows.length > 0 && selectedIds.size === workflows.length}
              onChange={toggleSelectAll}
              style={{ width: "1rem", height: "1rem", accentColor: "var(--primary)" }}
            />
            Select all
          </label>
          {selectedCount > 0 && (
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setShowBulkDeleteConfirm(true)}
              disabled={bulkDeleting}
              title={`Delete ${selectedCount} workflow(s)`}
              style={{ color: "#dc2626" }}
            >
              <Trash2 size={14} /> Delete {selectedCount} selected
            </button>
          )}
        </div>
      )}
      <ul className="list" style={{ marginTop: "0.5rem" }}>
        {workflows.map((workflow) => (
          <li key={workflow.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={selectedIds.has(workflow.id)}
              onChange={() => toggleSelect(workflow.id)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: "1rem", height: "1rem", flexShrink: 0, accentColor: "var(--primary)" }}
            />
            <Link
              href={workflow.id ? `/workflows/${encodeURIComponent(workflow.id)}` : "/workflows"}
              className="list-item"
              style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none", color: "inherit" }}
            >
              <WorkflowIcon size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{workflow.name}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {formatSchedule(workflow.executionMode, workflow.schedule)}
                </div>
              </div>
              <ChevronRight size={14} style={{ color: "var(--text-muted)", marginLeft: "auto" }} />
            </Link>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                executeWorkflow(workflow.id);
              }}
              disabled={executingId !== null}
              title="Execute once"
              style={{ flexShrink: 0 }}
            >
              <Play size={14} />
            </button>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setWorkflowToDelete(workflow);
              }}
              disabled={deleting}
              title="Delete workflow"
              style={{ color: "#dc2626", flexShrink: 0 }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      {showBulkDeleteConfirm && selectedCount > 0 && (
        <ConfirmModal
          open={true}
          title="Delete selected workflows"
          message={`Delete ${selectedCount} workflow(s)? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          loading={bulkDeleting}
          onConfirm={onConfirmBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}

      <ConfirmModal
        open={!!workflowToDelete}
        title="Delete workflow"
        message={workflowToDelete ? `Delete "${workflowToDelete.name}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => !deleting && setWorkflowToDelete(null)}
      />
    </div>
  );
}
