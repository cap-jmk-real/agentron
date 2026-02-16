"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, GitBranch, ChevronDown, ChevronRight, Play, FileEdit, ListChecks } from "lucide-react";
import ConfirmModal from "../../components/confirm-modal";
import WorkflowCanvas from "./workflow-canvas";
import { getNextNodePosition, getWorkflowGridOptions } from "../../lib/canvas-layout";
import WorkflowStackTracesView from "./workflow-stack-traces-view";

type Workflow = {
  id: string;
  name: string;
  description?: string;
  nodes: unknown[];
  edges: unknown[];
  executionMode: string;
  schedule?: string;
  maxRounds?: number | null;
  turnInstruction?: string | null;
};

type Agent = { id: string; name: string };

type WfNode = { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> };
type WfEdge = { id: string; source: string; target: string; data?: { label?: string } };

const INTERVAL_PRESETS = [
  { value: "60", label: "Every 1 minute" },
  { value: "300", label: "Every 5 minutes" },
  { value: "900", label: "Every 15 minutes" },
  { value: "1800", label: "Every 30 minutes" },
  { value: "3600", label: "Every 1 hour" },
  { value: "86400", label: "Daily" },
  { value: "604800", label: "Weekly" },
  { value: "2592000", label: "Monthly (30 days)" },
] as const;

const SCHEDULE_TYPES = ["interval", "daily", "weekly"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleToPreset(schedule: string): string {
  const s = schedule.trim();
  if (!s) return "";
  if (s.startsWith("daily@")) return "";
  if (s.startsWith("weekly@")) return "";
  if (s.startsWith("monthly@")) return "";
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return "custom";
  const found = INTERVAL_PRESETS.find((p) => p.value === String(n));
  return found ? found.value : "custom";
}

function scheduleToScheduleType(schedule: string): ScheduleType {
  const s = schedule.trim();
  if (!s) return "interval";
  if (s.startsWith("daily@")) return "daily";
  if (s.startsWith("weekly@")) return "weekly";
  return "interval";
}

function parseCalendarSchedule(schedule: string): {
  dailyTime: string;
  weeklyDays: number[];
} {
  const s = schedule.trim();
  const out = { dailyTime: "09:00", weeklyDays: [1] as number[] };
  if (s.startsWith("daily@")) {
    const time = s.slice(6).trim();
    if (/^\d{1,2}:\d{2}$/.test(time)) out.dailyTime = time;
  }
  if (s.startsWith("weekly@")) {
    const part = s.slice(7).trim();
    out.weeklyDays = part ? part.split(",").map((d) => Math.max(0, Math.min(6, parseInt(d, 10) || 0))) : [1];
  }
  return out;
}

function scheduleToCustomDisplay(schedule: string): { value: number; unit: "minutes" | "hours" } {
  const s = schedule.trim();
  if (s.startsWith("daily@") || s.startsWith("weekly@")) return { value: 5, unit: "minutes" };
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n <= 0) return { value: 5, unit: "minutes" };
  if (n >= 3600 && n % 3600 === 0) return { value: n / 3600, unit: "hours" };
  if (n % 60 === 0) return { value: n / 60, unit: "minutes" };
  return { value: Math.max(1, Math.round(n / 60)), unit: "minutes" };
}

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.id as string;

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState("[]");
  const [edges, setEdges] = useState("[]");
  const [name, setName] = useState("");
  const [mode, setMode] = useState("one_time");
  const [schedule, setSchedule] = useState("");
  const [maxRounds, setMaxRounds] = useState<string>("");
  const [turnInstruction, setTurnInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("interval");
  const [intervalPreset, setIntervalPreset] = useState<string>("");
  const [customIntervalValue, setCustomIntervalValue] = useState(5);
  const [customIntervalUnit, setCustomIntervalUnit] = useState<"minutes" | "hours">("minutes");
  const [calendarDailyTime, setCalendarDailyTime] = useState("09:00");
  const [calendarWeeklyDays, setCalendarWeeklyDays] = useState<number[]>([1]);
  const [detailTab, setDetailTab] = useState<"editor" | "traces">("editor");

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, []);

  const parsedNodes = ((): WfNode[] => {
    try {
      return JSON.parse(nodes) as WfNode[];
    } catch {
      return [];
    }
  })();
  const parsedEdges = ((): WfEdge[] => {
    try {
      return JSON.parse(edges) as WfEdge[];
    } catch {
      return [];
    }
  })();

  const hasUnwiredAgentNodes = parsedNodes.some(
    (n) => n.type === "agent" && !(typeof n.parameters?.agentId === "string" && n.parameters.agentId.trim() !== "")
  );

  const addAgentNode = useCallback(() => {
    const id = `agent-${Date.now()}`;
    const agentId = agents[0]?.id ?? "";
    const existingPositions = parsedNodes.map((n) => ({ x: n.position[0], y: n.position[1] }));
    const pos = getNextNodePosition(existingPositions, getWorkflowGridOptions());
    const parsed = [...parsedNodes, { id, type: "agent", position: [pos.x, pos.y], parameters: { agentId } }];
    setNodes(JSON.stringify(parsed, null, 2));
  }, [parsedNodes, agents]);

  const addAgentNodeAt = useCallback(
    (position: { x: number; y: number }, agentId?: string) => {
      const id = `node-${Date.now()}`;
      const newNode = {
        id,
        type: "agent",
        position: [position.x, position.y] as [number, number],
        parameters: { agentId: agentId ?? agents[0]?.id ?? "" },
      };
      const parsed = [...parsedNodes, newNode];
      setNodes(JSON.stringify(parsed, null, 2));
    },
    [parsedNodes, agents]
  );

  const onCanvasNodesEdgesChange = useCallback((newNodes: WfNode[], newEdges: WfEdge[]) => {
    setNodes(JSON.stringify(newNodes, null, 2));
    setEdges(JSON.stringify(newEdges, null, 2));
  }, []);

  const executeWorkflow = useCallback(async () => {
    if (!workflowId) return;
    setExecuting(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/execute`, { method: "POST" });
      const data = res.ok ? await res.json() : null;
      if (data?.id) {
        router.push(`/runs/${data.id}`);
      }
    } finally {
      setExecuting(false);
    }
  }, [workflowId, router]);

  useEffect(() => {
    if (!workflowId) {
      setLoading(false);
      return;
    }
    fetch(`/api/workflows/${workflowId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) return;
        setWorkflow(data);
        setName(data.name ?? "");
        setMode(data.executionMode ?? "one_time");
        const s = data.schedule ?? "";
        setSchedule(s);
        setScheduleType(scheduleToScheduleType(s));
        setIntervalPreset(scheduleToPreset(s));
        const custom = scheduleToCustomDisplay(s);
        setCustomIntervalValue(custom.value);
        setCustomIntervalUnit(custom.unit);
        const cal = parseCalendarSchedule(s);
        setCalendarDailyTime(cal.dailyTime);
        setCalendarWeeklyDays(cal.weeklyDays.length ? cal.weeklyDays : [1]);
        setMaxRounds(data.maxRounds != null ? String(data.maxRounds) : "");
        setTurnInstruction(data.turnInstruction ?? "");
        setNodes(JSON.stringify(data.nodes ?? [], null, 2));
        setEdges(JSON.stringify(data.edges ?? [], null, 2));
      })
      .finally(() => setLoading(false));
  }, [workflowId]);

  const getScheduleToSave = useCallback((): string => {
    if (mode !== "interval") return "";
    if (scheduleType === "daily") {
      const t = calendarDailyTime.trim();
      return t ? `daily@${t}` : "";
    }
    if (scheduleType === "weekly") {
      const days = [...calendarWeeklyDays].sort((a, b) => a - b).filter((d, i, arr) => arr.indexOf(d) === i);
      return days.length ? `weekly@${days.join(",")}` : "";
    }
    if (intervalPreset && intervalPreset !== "custom") return intervalPreset;
    const value = Math.max(1, customIntervalValue);
    const seconds = customIntervalUnit === "hours" ? value * 3600 : value * 60;
    return String(seconds);
  }, [mode, scheduleType, intervalPreset, customIntervalValue, customIntervalUnit, calendarDailyTime, calendarWeeklyDays]);

  const save = async () => {
    if (!workflow) return;
    setSaving(true);
    let parsedNodes: unknown[] = [];
    let parsedEdges: unknown[] = [];
    try {
      parsedNodes = JSON.parse(nodes);
      parsedEdges = JSON.parse(edges);
    } catch {
      setSaving(false);
      return;
    }
    const scheduleToSave = getScheduleToSave();
    const res = await fetch(`/api/workflows/${workflowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...workflow,
        name,
        executionMode: mode,
        schedule: scheduleToSave || undefined,
        maxRounds: maxRounds.trim() === "" ? undefined : Math.max(1, parseInt(maxRounds, 10) || 1),
        turnInstruction: turnInstruction.trim() || undefined,
        nodes: parsedNodes,
        edges: parsedEdges,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setWorkflow(updated);
    }
    setSaving(false);
  };

  const onConfirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteModal(false);
        router.push("/workflows");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Loading...</p>;
  if (!workflowId || !workflow) {
    return (
      <div className="card" style={{ padding: "2rem", maxWidth: 400 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Workflow not found</p>
        <p style={{ margin: "0.5rem 0 1rem", fontSize: "0.88rem", color: "var(--text-muted)" }}>
          The workflow may have been deleted or the link is invalid.
        </p>
        <Link href="/workflows" className="button">
          Back to Workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="page-content" style={{ width: "100%", maxWidth: "100%" }}>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/workflows" style={{ fontSize: "0.85rem", color: "var(--primary)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <ArrowLeft size={14} /> Workflows
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>{name || "Untitled Workflow"}</h1>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button
            type="button"
            className="button button-success"
            onClick={executeWorkflow}
            disabled={executing}
            title="Execute workflow once"
          >
            <Play size={14} /> {executing ? "Starting…" : "Execute once"}
          </button>
          <button className="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="button button-danger" onClick={() => setShowDeleteModal(true)}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: "1rem", gap: 0 }}>
        <button
          type="button"
          onClick={() => setDetailTab("editor")}
          style={{
            padding: "0.5rem 1rem",
            background: detailTab === "editor" ? "var(--surface-muted)" : "transparent",
            border: "none",
            borderBottom: detailTab === "editor" ? "2px solid var(--primary)" : "2px solid transparent",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          <FileEdit size={16} /> Editor
        </button>
        <button
          type="button"
          onClick={() => setDetailTab("traces")}
          style={{
            padding: "0.5rem 1rem",
            background: detailTab === "traces" ? "var(--surface-muted)" : "transparent",
            border: "none",
            borderBottom: detailTab === "traces" ? "2px solid var(--primary)" : "2px solid transparent",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          <ListChecks size={16} /> Stack traces
        </button>
      </div>
      {detailTab === "traces" && (
        <div className="card" style={{ padding: "0", overflow: "hidden", minHeight: 360 }}>
          <WorkflowStackTracesView workflowId={workflowId} />
        </div>
      )}
      {detailTab === "editor" && (
      <>
      <div className="card form" style={{ marginBottom: "1.5rem" }}>
        <div className="field">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" />
        </div>
        <div className="field">
          <label>Execution Mode</label>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="one_time">one_time</option>
            <option value="continuous">continuous</option>
            <option value="interval">interval (scheduled)</option>
          </select>
        </div>
        {mode === "interval" && (
          <>
            <div className="field">
              <label>Schedule</label>
              <select
                className="select"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
              >
                <option value="interval">Interval (every X)</option>
                <option value="daily">Daily at time</option>
                <option value="weekly">Weekly on days</option>
              </select>
            </div>
            {scheduleType === "interval" && (
              <>
                <div className="field">
                  <label>Interval</label>
                  <select
                    className="select"
                    value={intervalPreset}
                    onChange={(e) => setIntervalPreset(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {INTERVAL_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {intervalPreset === "custom" && (
                  <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <label style={{ margin: 0 }}>Every</label>
                    <input
                      type="number"
                      min={1}
                      className="input"
                      style={{ width: 72 }}
                      value={customIntervalValue}
                      onChange={(e) => setCustomIntervalValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                    <select
                      className="select"
                      style={{ width: 100 }}
                      value={customIntervalUnit}
                      onChange={(e) => setCustomIntervalUnit(e.target.value as "minutes" | "hours")}
                    >
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                    </select>
                  </div>
                )}
              </>
            )}
            {scheduleType === "daily" && (
              <div className="field">
                <label>Time (HH:mm)</label>
                <input
                  type="time"
                  className="input"
                  style={{ width: 120 }}
                  value={calendarDailyTime}
                  onChange={(e) => setCalendarDailyTime(e.target.value || "09:00")}
                />
              </div>
            )}
            {scheduleType === "weekly" && (
              <div className="field">
                <label>Days of week</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {WEEKDAY_LABELS.map((label, i) => (
                    <label key={i} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={calendarWeeklyDays.includes(i)}
                        onChange={() => {
                          if (calendarWeeklyDays.includes(i)) {
                            setCalendarWeeklyDays(calendarWeeklyDays.filter((d) => d !== i));
                          } else {
                            setCalendarWeeklyDays([...calendarWeeklyDays, i].sort((a, b) => a - b));
                          }
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <div className="field">
          <label>Max rounds (for circular workflows)</label>
          <input
            type="number"
            min={1}
            className="input"
            value={maxRounds}
            onChange={(e) => setMaxRounds(e.target.value)}
            placeholder="e.g. 3 — limits conversation turns when agents are connected in a circle"
          />
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
            When nodes are connected in a circle (e.g. Agent A → Agent B → Agent A), set this to avoid endless loops. Leave empty for linear workflows.
          </p>
        </div>
        <div className="field">
          <label>Turn instruction (for multi-agent conversations)</label>
          <textarea
            className="input"
            value={turnInstruction}
            onChange={(e) => setTurnInstruction(e.target.value)}
            placeholder="e.g. Reply directly to what the partner just said; do not give a disconnected monologue."
            rows={2}
            style={{ resize: "vertical" }}
          />
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
            Optional. Shown at the start of each agent turn so they reply to each other instead of monologuing. Leave empty for no instruction.
          </p>
        </div>
      </div>
      <div className="card form form-wide canvas-card" style={{ marginBottom: "1.5rem", padding: 0 }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <GitBranch size={18} style={{ color: "var(--text-muted)" }} />
            <label style={{ fontWeight: 600 }}>Canvas</label>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
            Drag agent nodes onto the canvas and connect them. Use tools on each agent to handle input and output. Pan and zoom with the controls. Set <strong>Max rounds</strong> above for circular workflows.
          </p>
        </div>
        <WorkflowCanvas
          wfNodes={parsedNodes}
          wfEdges={parsedEdges}
          agents={agents}
          onNodesEdgesChange={onCanvasNodesEdgesChange}
          onAddNode={addAgentNode}
          onAddNodeAt={addAgentNodeAt}
        />
      </div>
      <div className="card form form-wide">
        <button
          type="button"
          onClick={() => setShowJson(!showJson)}
          style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: showJson ? "0.75rem" : 0, background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", color: "var(--text-muted)" }}
        >
          {showJson ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Advanced: edit nodes/edges as JSON
        </button>
        {showJson && (
          <>
            <div className="field">
              <label>Nodes (JSON)</label>
              <textarea className="textarea" rows={6} value={nodes} onChange={(e) => setNodes(e.target.value)} />
            </div>
            <div className="field">
              <label>Edges (JSON)</label>
              <textarea className="textarea" rows={4} value={edges} onChange={(e) => setEdges(e.target.value)} />
            </div>
          </>
        )}
      </div>

      </>
      )}
      <ConfirmModal
        open={showDeleteModal}
        title="Delete workflow"
        message="Delete this workflow? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => !deleting && setShowDeleteModal(false)}
      />
    </div>
  );
}
