"use client";

import { useState, useCallback, useEffect } from "react";
import { Bug, ScrollText, Copy } from "lucide-react";

function buildDebugBlock(data: {
  dataDir?: string;
  logPath?: string;
  version?: string | number;
  logWritable?: boolean;
  logExcerpt?: string;
}) {
  const dataDir = data.dataDir ?? "(unknown)";
  const logPath = data.logPath ?? "(unknown)";
  const version = data.version != null ? String(data.version) : "(unknown)";
  const logWritable = data.logWritable === true;
  const logExcerpt = data.logExcerpt ?? "";
  return [
    "## Debug info",
    "",
    "- **App version:** " + version,
    "- **Data dir:** `" + dataDir + "`",
    "- **Log file:** `" + logPath + "`",
    "- **Log writable:** " + (logWritable ? "yes" : "no"),
    "",
    "### Recent API log",
    "```",
    logExcerpt || "(no log entries yet)",
    "```",
  ].join("\n");
}

/**
 * Fetches /api/debug/info and copies a GitHub-issue-friendly block to the clipboard.
 * Shows a view icon to the left that opens a modal with the same content (selectable + copy button).
 */
export default function CopyDebugInfoButton({
  label = "Copy debug info for GitHub",
  variant = "ghost",
  size = "small",
  className = "",
}: {
  label?: string;
  variant?: "ghost" | "primary";
  size?: "small" | "normal";
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState<string | null>(null);
  const [modalCopyStatus, setModalCopyStatus] = useState<"idle" | "copied">("idle");

  const fetchDebugInfo = useCallback(async () => {
    const res = await fetch("/api/debug/info");
    const data = await res.json().catch(() => ({}));
    return { data, block: buildDebugBlock(data) };
  }, []);

  const copy = useCallback(async () => {
    setStatus("copying");
    try {
      const { block } = await fetchDebugInfo();
      await navigator.clipboard.writeText(block);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [fetchDebugInfo]);

  const openModal = useCallback(async () => {
    setModalOpen(true);
    setModalContent(null);
    try {
      const { block } = await fetchDebugInfo();
      setModalContent(block);
    } catch {
      setModalContent("Failed to load debug info.");
    }
  }, [fetchDebugInfo]);

  const closeModal = useCallback(() => setModalOpen(false), []);

  const copyFromModal = useCallback(async () => {
    if (!modalContent) return;
    try {
      await navigator.clipboard.writeText(modalContent);
      setModalCopyStatus("copied");
      setTimeout(() => setModalCopyStatus("idle"), 2000);
    } catch {
      setModalCopyStatus("idle");
    }
  }, [modalContent]);

  useEffect(() => {
    if (!modalOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [modalOpen, closeModal]);

  const isSmall = size === "small";
  const btnClass = variant === "primary" ? "button" : "button button-ghost";
  const sizeClass = isSmall ? "button-small" : "";
  const iconSize = isSmall ? 14 : 16;

  return (
    <>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }} className={className}>
        <button
          type="button"
          className={`${btnClass} ${sizeClass}`.trim()}
          onClick={openModal}
          title="View debug info and logs"
          aria-label="View debug info and logs"
        >
          <ScrollText size={iconSize} />
        </button>
        <button
          type="button"
          className={`${btnClass} ${sizeClass}`.trim()}
          onClick={copy}
          disabled={status === "copying"}
          title="Copy version, data dir and recent API errors for pasting into a GitHub issue"
        >
          {status === "copying" ? (
            <span style={{ fontSize: isSmall ? "0.8rem" : "0.85rem" }}>Copying…</span>
          ) : status === "copied" ? (
            <span style={{ fontSize: isSmall ? "0.8rem" : "0.85rem", color: "var(--primary)" }}>Copied!</span>
          ) : status === "error" ? (
            <span style={{ fontSize: isSmall ? "0.8rem" : "0.85rem", color: "#dc2626" }}>Failed to copy</span>
          ) : (
            <>
              <Bug size={iconSize} style={{ marginRight: "0.35rem" }} />
              {label}
            </>
          )}
        </button>
      </div>

      {modalOpen && (
        <div
          className="confirm-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="debug-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="card confirm-modal-card"
            style={{ maxWidth: "min(90vw, 560px)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexShrink: 0 }}>
              <h3 id="debug-modal-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                Debug info
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={copyFromModal}
                  disabled={!modalContent || modalContent.startsWith("Failed")}
                  title="Copy to clipboard"
                >
                  {modalCopyStatus === "copied" ? (
                    "Copied!"
                  ) : (
                    <>
                      <Copy size={14} style={{ marginRight: "0.25rem" }} />
                      Copy
                    </>
                  )}
                </button>
                <button type="button" className="button button-ghost button-small" onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                background: "var(--bg-subtle)",
                borderRadius: "var(--radius)",
                padding: "0.75rem",
                border: "1px solid var(--border)",
              }}
            >
              {modalContent === null ? (
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading…</span>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontSize: "0.8rem",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    userSelect: "text",
                    cursor: "text",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {modalContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
