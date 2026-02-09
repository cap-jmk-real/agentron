"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, BookOpen, ChevronDown } from "lucide-react";

type Skill = {
  id: string;
  name: string;
  description?: string;
  type: string;
  content?: string;
  config?: unknown;
  sortOrder?: number;
  agentConfig?: unknown;
};

type Props = {
  agentId: string;
};

export default function SkillsEditor({ agentId }: Props) {
  const [assigned, setAssigned] = useState<Skill[]>([]);
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newType, setNewType] = useState("instruction");
  const [creating, setCreating] = useState(false);

  const fetchAssigned = () => {
    fetch(`/api/agents/${agentId}/skills`)
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setAssigned(data) : setAssigned([])))
      .catch(() => setAssigned([]));
  };

  const fetchAll = () => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setAllSkills(data) : setAllSkills([])))
      .catch(() => setAllSkills([]));
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/agents/${agentId}/skills`).then((r) => r.json()),
      fetch("/api/skills").then((r) => r.json()),
    ])
      .then(([assignedData, allData]) => {
        setAssigned(Array.isArray(assignedData) ? assignedData : []);
        setAllSkills(Array.isArray(allData) ? allData : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  const assignedIds = new Set(assigned.map((s) => s.id));
  const available = allSkills.filter((s) => !assignedIds.has(s.id));

  const addSkill = async (skillId: string) => {
    setAdding(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (res.ok) {
        fetchAssigned();
        setShowAdd(false);
      }
    } finally {
      setAdding(false);
    }
  };

  const removeSkill = async (skillId: string) => {
    const res = await fetch(`/api/agents/${agentId}/skills`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId }),
    });
    if (res.ok) fetchAssigned();
  };

  const createSkill = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          type: newType,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        fetchAll();
        setNewName("");
        setNewDescription("");
        setCreateOpen(false);
        await addSkill(created.id);
      }
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>Loading skills...</p>;
  }

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <BookOpen size={16} /> Skills
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", margin: "0 0 1rem" }}>
        Attach reusable capabilities to this agent (e.g. document handling, code execution, domain instructions). Similar to Anthropic Agent Skills.
      </p>

      {assigned.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 1rem" }}>
          No skills attached. Add one below or create a new skill.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
          {assigned.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.6rem 0.75rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
                marginBottom: "0.4rem",
                background: "var(--surface)",
              }}
            >
              <div>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{s.name}</span>
                {s.type && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    ({s.type})
                  </span>
                )}
                {s.description && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {s.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => removeSkill(s.id)}
                title="Remove skill"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="button"
            onClick={() => setShowAdd((v) => !v)}
            disabled={adding}
          >
            <Plus size={14} /> Add skill <ChevronDown size={12} style={{ marginLeft: "0.2rem" }} />
          </button>
          {showAdd && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 10 }}
                onClick={() => setShowAdd(false)}
                aria-hidden
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  minWidth: 220,
                  maxHeight: 280,
                  overflow: "auto",
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "var(--shadow)",
                  zIndex: 20,
                }}
              >
                {available.length === 0 ? (
                  <div style={{ padding: "0.75rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    No other skills. Create one below.
                  </div>
                ) : (
                  available.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="button"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        textAlign: "left",
                        borderRadius: 0,
                        border: "none",
                        borderBottom: "1px solid var(--border)",
                        padding: "0.5rem 0.75rem",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                      onClick={() => addSkill(s.id)}
                    >
                      <span style={{ fontWeight: 500 }}>{s.name}</span>
                      {s.type && (
                        <span style={{ marginLeft: "0.35rem", fontSize: "0.75rem", opacity: 0.8 }}>
                          {s.type}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <button type="button" className="button button-secondary" onClick={() => setCreateOpen((v) => !v)}>
          <Plus size={14} /> Create new skill
        </button>
      </div>

      {createOpen && (
        <div
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-muted)",
          }}
        >
          <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>New skill</h4>
          <div className="form" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. PDF processing"
              />
            </div>
            <div className="field">
              <label>Description (when to use)</label>
              <input
                className="input"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Extract text and tables from PDFs, fill forms..."
              />
            </div>
            <div className="field">
              <label>Type</label>
              <select className="select" value={newType} onChange={(e) => setNewType(e.target.value)}>
                <option value="instruction">Instruction</option>
                <option value="document">Document</option>
                <option value="code">Code</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="button" onClick={createSkill} disabled={creating || !newName.trim()}>
                {creating ? "Creating..." : "Create & attach to agent"}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
