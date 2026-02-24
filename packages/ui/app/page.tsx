"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserCheck, Check, X } from "lucide-react";
import LogoLoading from "./components/logo-loading";

type WorkflowOverview = {
  id: string;
  name: string;
  totalRuns: number;
  agentCount: number;
  llmCount: number;
  totalTokens: number;
  estimatedCost: number;
};

type PendingTask = {
  id: string;
  workflowId: string;
  agentId: string;
  stepName: string;
  label?: string;
  status: string;
  createdAt: number;
};

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function HomePage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowOverview[]>([]);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [agentsMap, setAgentsMap] = useState<Record<string, { name: string }>>({});
  const [workflowsMap, setWorkflowsMap] = useState<Record<string, { name: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data: { vaultExists?: boolean }) => {
        if (data.vaultExists === false) router.replace("/setup");
      })
      .catch(() => {});
  }, [router]);

  const loadHome = () =>
    fetch("/api/home")
      .then((r) => r.json())
      .then(
        (data: {
          workflows?: WorkflowOverview[];
          tasks?: PendingTask[];
          agents?: Record<string, { name: string }>;
          workflowsMap?: Record<string, { name: string }>;
        }) => {
          setWorkflows(data.workflows ?? []);
          setPendingTasks(data.tasks ?? []);
          setAgentsMap(data.agents ?? {});
          setWorkflowsMap(data.workflowsMap ?? {});
        }
      )
      .finally(() => setLoading(false));

  useEffect(() => {
    loadHome();
  }, []);

  const resolveTask = async (taskId: string, status: "approved" | "rejected") => {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadHome();
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 0.25rem" }}>Agentron</h1>
      <p style={{ color: "var(--text-muted)", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
        Overview of active workflows and token usage.
      </p>

      {pendingTasks.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              margin: "0 0 0.75rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <UserCheck size={18} /> Tasks needing approval
          </h2>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
            These agents in a workflow are waiting for your approval before continuing.
          </p>
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
            {pendingTasks.map((task) => (
              <li
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.6rem 0.75rem",
                  background: "var(--surface-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                    {workflowsMap[task.workflowId]?.name ?? task.workflowId} →{" "}
                    {agentsMap[task.agentId]?.name ?? task.agentId}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    Step: {task.stepName}
                    {task.label ? ` — ${task.label}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                  <button
                    type="button"
                    className="button button-small"
                    style={{ color: "var(--success, #22c55e)" }}
                    onClick={() => resolveTask(task.id, "approved")}
                    title="Approve"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    className="button button-small"
                    style={{ color: "var(--danger, #ef4444)" }}
                    onClick={() => resolveTask(task.id, "rejected")}
                    title="Reject"
                  >
                    <X size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
          Active workflows
        </h2>
        {loading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.75rem",
              padding: "1rem 0",
            }}
          >
            <LogoLoading size={48} />
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", margin: 0 }}>Loading…</p>
          </div>
        ) : workflows.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            No workflows yet. Create one from{" "}
            <Link href="/workflows" style={{ color: "var(--link)" }}>
              Workflows
            </Link>{" "}
            or via the chat.
          </p>
        ) : (
          <div
            style={{
              overflowX: "auto",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface)",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Workflow</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Agents</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>LLMs</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Token throughput</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Runs</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf) => (
                  <tr key={wf.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.6rem 0.75rem" }}>
                      <Link
                        href={`/stats/workflows/${wf.id}`}
                        style={{ color: "var(--text)", textDecoration: "none", fontWeight: 500 }}
                      >
                        {wf.name}
                      </Link>
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", color: "var(--text-muted)" }}>
                      {wf.agentCount}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", color: "var(--text-muted)" }}>
                      {wf.llmCount}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", color: "var(--text-muted)" }}>
                      {fmtTokens(wf.totalTokens)}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", color: "var(--text-muted)" }}>
                      {wf.totalRuns}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Go to{" "}
        <Link href="/stats" style={{ color: "var(--link)" }}>
          Statistics
        </Link>{" "}
        for full breakdown by agent and cost.
      </p>
    </div>
  );
}
