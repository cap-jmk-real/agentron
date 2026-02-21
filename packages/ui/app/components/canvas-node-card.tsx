"use client";

import { Handle, Position } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  /** Icon shown before the label (e.g. lucide icon) */
  icon?: ReactNode;
  /** Uppercase label in the header */
  label: string;
  /** Whether the node is selected (affects border) */
  selected?: boolean;
  /** Called when the remove button is clicked */
  onRemove?: () => void;
  /** Main body content below the header */
  children: ReactNode;
  /** Whether to render a target handle at the top. Default true when flow is vertical. */
  handleTop?: boolean;
  /** Whether to render a source handle at the bottom. Default true when flow is vertical. */
  handleBottom?: boolean;
  /** For horizontal (left-to-right) flow: target handle on the left. When set, top/bottom handles are not used. */
  handleLeft?: boolean;
  /** For horizontal flow: source handle on the right. When set with handleLeft, uses LTR flow. */
  handleRight?: boolean;
  /** Minimum width of the card (CSS value) */
  minWidth?: number | string;
  /** Maximum width of the card (CSS value) */
  maxWidth?: number | string;
};

const cardStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: 8,
  background: "var(--surface)",
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.35rem",
  marginBottom: "0.35rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

/**
 * Shared card shell for canvas nodes (agent graph and workflow canvases).
 * Provides consistent styling: padding, border, header with icon + label + remove button,
 * optional top/bottom connection handles.
 */
export function CanvasNodeCard({
  icon,
  label,
  selected = false,
  onRemove,
  children,
  handleTop = true,
  handleBottom = true,
  handleLeft,
  handleRight,
  minWidth,
  maxWidth,
}: Props) {
  const horizontal = handleLeft !== undefined || handleRight !== undefined;
  const showTargetLeft = horizontal && handleLeft !== false;
  const showSourceRight = horizontal && handleRight !== false;
  const showTargetTop = !horizontal && handleTop;
  const showSourceBottom = !horizontal && handleBottom;

  const style: React.CSSProperties = {
    ...cardStyle,
    position: "relative",
    border: `2px solid ${selected ? "var(--primary)" : "var(--border)"}`,
    ...(minWidth != null && { minWidth: typeof minWidth === "number" ? minWidth : minWidth }),
    ...(maxWidth != null && { maxWidth: typeof maxWidth === "number" ? maxWidth : maxWidth }),
  };

  return (
    <div style={style}>
      {showTargetLeft && (
        <Handle type="target" position={Position.Left} style={{ width: 10, height: 10 }} />
      )}
      {showTargetTop && (
        <Handle type="target" position={Position.Top} style={{ top: 0, width: 10, height: 10 }} />
      )}
      {/* Drag handle: only icon+label start node drag; rest is nodrag so click works on controls */}
      <div className="nopan">
        <div style={headerStyle}>
          <div
            className="drag-handle"
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}
          >
            {icon}
            <span style={labelStyle}>{label}</span>
          </div>
          {onRemove && (
            <button
              type="button"
              className="canvas-node-remove-btn nodrag nopan"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onRemove();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Remove"
              aria-label="Remove"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <div
          className="nodrag"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
      {showSourceRight && (
        <Handle type="source" position={Position.Right} style={{ width: 10, height: 10 }} />
      )}
      {showSourceBottom && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ bottom: 0, width: 10, height: 10 }}
        />
      )}
    </div>
  );
}
