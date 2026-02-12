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
  /** Whether to render a target handle at the top. Default true. */
  handleTop?: boolean;
  /** Whether to render a source handle at the bottom. Default true. */
  handleBottom?: boolean;
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
  minWidth,
  maxWidth,
}: Props) {
  const style: React.CSSProperties = {
    ...cardStyle,
    border: `2px solid ${selected ? "var(--primary)" : "var(--border)"}`,
    ...(minWidth != null && { minWidth: typeof minWidth === "number" ? minWidth : minWidth }),
    ...(maxWidth != null && { maxWidth: typeof maxWidth === "number" ? maxWidth : maxWidth }),
  };

  return (
    <div style={style}>
      {handleTop && (
        <Handle type="target" position={Position.Top} style={{ top: 0, width: 10, height: 10 }} />
      )}
      {/* Wrapper with nopan so the whole node body does not trigger canvas pan; cursor over controls is set by .nopan in CSS */}
      <div className="nopan" style={{ cursor: "default" }}>
        <div style={headerStyle}>
          {icon}
          <span style={labelStyle}>{label}</span>
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
        {children}
      </div>
      {handleBottom && (
        <Handle type="source" position={Position.Bottom} style={{ bottom: 0, width: 10, height: 10 }} />
      )}
    </div>
  );
}
