import { describe, it, expect } from "vitest";
import {
  formatRequestQueueTs,
  describeContext,
  groupPending,
  groupDelayed,
  type LLMRequestContext,
  type PendingEntry,
  type DelayedEntry,
  type AggregateBy,
} from "../../../app/queues/request-queue-section";

describe("request-queue-section", () => {
  describe("formatRequestQueueTs", () => {
    it("formats timestamp with milliseconds", () => {
      const ts = 1700000000123; // fixed date
      const s = formatRequestQueueTs(ts);
      expect(s).toMatch(/\d{1,2}:\d{2}:\d{2}\.\d{3}/);
      expect(s.endsWith(".123")).toBe(true);
    });
  });

  describe("describeContext", () => {
    it("returns source only when no workflow or agent", () => {
      expect(describeContext({ source: "chat" })).toBe("chat");
      expect(describeContext({ source: "workflow" })).toBe("workflow");
    });

    it("includes workflow id prefix when present", () => {
      const ctx: LLMRequestContext = { source: "workflow", workflowId: "wf-abc12345" };
      expect(describeContext(ctx)).toBe("workflow | workflow wf-abc12…");
    });

    it("includes agent id prefix when present", () => {
      const ctx: LLMRequestContext = { source: "agent", agentId: "ag-xyz98765" };
      expect(describeContext(ctx)).toBe("agent | agent ag-xyz98…");
    });
  });

  describe("groupPending", () => {
    const pending: PendingEntry[] = [
      { id: "1", key: "k1", context: { source: "chat" }, addedAt: 1 },
      { id: "2", key: "k2", context: { source: "workflow", workflowId: "wf-a" }, addedAt: 2 },
      { id: "3", key: "k3", context: { source: "workflow", workflowId: "wf-a" }, addedAt: 3 },
    ];

    it("groups by none (each id)", () => {
      const m = groupPending(pending, "none");
      expect(m.size).toBe(3);
      expect(m.get("1")).toHaveLength(1);
      expect(m.get("2")).toHaveLength(1);
      expect(m.get("3")).toHaveLength(1);
    });

    it("groups by source", () => {
      const m = groupPending(pending, "source");
      expect(m.size).toBe(2);
      expect(m.get("chat")).toHaveLength(1);
      expect(m.get("workflow")).toHaveLength(2);
    });

    it("groups by workflow", () => {
      const m = groupPending(pending, "workflow");
      expect(m.get("(no workflow)")).toHaveLength(1);
      expect(m.get("wf-a")).toHaveLength(2);
    });
  });

  describe("groupDelayed", () => {
    const delayed: DelayedEntry[] = [
      {
        key: "k1",
        context: { source: "agent", agentId: "ag-1" },
        addedAt: 1,
        completedAt: 2,
        waitedMs: 10,
      },
      {
        key: "k2",
        context: { source: "agent", agentId: "ag-1" },
        addedAt: 3,
        completedAt: 4,
        waitedMs: 20,
      },
    ];

    it("groups by agent", () => {
      const m = groupDelayed(delayed, "agent");
      expect(m.get("ag-1")).toHaveLength(2);
    });

    it("groups by source", () => {
      const m = groupDelayed(delayed, "source");
      expect(m.get("agent")).toHaveLength(2);
    });
  });
});
