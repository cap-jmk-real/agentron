"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export type LabelEdgeData = {
  label?: string;
};

/**
 * Custom edge that shows an optional label on the path.
 * Use with edge type "labelEdge" and pass data.label for the text.
 */
export function CanvasLabelEdge({
  id,
  data,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  selected,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = (data?.label as string | undefined) ?? "";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          ...(style as Record<string, unknown>),
          stroke: selected ? "var(--primary)" : "var(--primary)",
          strokeWidth: selected ? 3 : 2,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nopan nodrag"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              fontSize: "0.7rem",
              fontWeight: 500,
              color: "var(--text)",
              background: "var(--surface)",
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
