"use client";

import { useState, useEffect, useRef } from "react";

/** Minimum time (ms) to show task tracing steps before hiding them when the final response arrives. */
export const MIN_STEPS_DISPLAY_MS = 2500;

/**
 * Delays hiding task tracing (steps, trace, reasoning) so users have time to see what was done.
 * When hasFinalResponseContent becomes true, we keep showing steps for at least minMs before
 * switching to the final response view.
 */
export function useMinimumStepsDisplayTime(
  msgId: string,
  hasFinalResponseContent: boolean,
  minMs: number = MIN_STEPS_DISPLAY_MS
): boolean {
  const [allowHide, setAllowHide] = useState(false);
  const becameTrueAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasFinalResponseContent) {
      becameTrueAtRef.current = null;
      queueMicrotask(() => setAllowHide(false));
      return;
    }
    if (becameTrueAtRef.current === null) {
      becameTrueAtRef.current = Date.now();
    }
    const elapsed = Date.now() - becameTrueAtRef.current;
    const remaining = Math.max(0, minMs - elapsed);
    const t = setTimeout(() => setAllowHide(true), remaining);
    return () => clearTimeout(t);
  }, [msgId, hasFinalResponseContent, minMs]);

  return hasFinalResponseContent && allowHide;
}
