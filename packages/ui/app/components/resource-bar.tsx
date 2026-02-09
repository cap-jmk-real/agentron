"use client";

/** Green / yellow / red by usage level. Usage 0–100%: green &lt; 70%, yellow 70–88%, red ≥ 88%. */
export function usageBarColor(pct: number): string {
  if (pct < 70) return "var(--resource-green, #22c55e)";
  if (pct < 88) return "var(--resource-yellow, #eab308)";
  return "var(--resource-red, #ef4444)";
}

/** For disk: pct = used %. Same thresholds. */
export function diskUsedBarColor(usedPct: number): string {
  return usageBarColor(usedPct);
}

type ResourceBarProps = {
  /** 0–100 (usage percentage). Bar width = this value. */
  percent: number;
  /** Optional override; otherwise from usageBarColor(percent). */
  color?: string;
  height?: number;
  className?: string;
};

export function ResourceBar({ percent, color, height = 4, className = "" }: ResourceBarProps) {
  const pct = Math.min(100, Math.max(0, percent));
  const fillColor = color ?? usageBarColor(pct);
  return (
    <div
      className={className}
      style={{
        width: "100%",
        height,
        borderRadius: 2,
        background: "var(--border)",
        overflow: "hidden",
      }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 2,
          background: fillColor,
          transition: "width 0.2s ease, background 0.2s ease",
        }}
      />
    </div>
  );
}
