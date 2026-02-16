import { describe, it, expect } from "vitest";
import {
  AGENT_PATTERN_EXAMPLES,
  getAllPrompts,
  getExamplesByLevel,
  type AgentPatternId,
} from "./agent-pattern-examples";

const VALID_PATTERN_IDS: AgentPatternId[] = [
  "prompt-chaining",
  "autonomous-agent",
  "sequential-llm-tool-llm",
  "role-based-assembly-line",
  "evaluator-optimizer",
  "orchestrator-workers",
  "diagnose-fix-rerun",
  "composition-over-complexity",
];

describe("agent-pattern-examples fixture", () => {
  it("exports all expected pattern ids", () => {
    const ids = AGENT_PATTERN_EXAMPLES.map((e) => e.patternId);
    expect(ids.sort()).toEqual([...VALID_PATTERN_IDS].sort());
  });

  it("each pattern has at least one prompt", () => {
    for (const ex of AGENT_PATTERN_EXAMPLES) {
      expect(ex.prompts.length).toBeGreaterThanOrEqual(1);
      expect(ex.prompts.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
    }
  });

  it("each pattern has a non-empty label and valid level", () => {
    const levels = ["intra", "workflow", "meta"] as const;
    for (const ex of AGENT_PATTERN_EXAMPLES) {
      expect(ex.label.length).toBeGreaterThan(0);
      expect(levels).toContain(ex.level);
    }
  });

  it("getAllPrompts returns one entry per prompt with correct patternId", () => {
    const all = getAllPrompts();
    let count = 0;
    for (const ex of AGENT_PATTERN_EXAMPLES) {
      const forPattern = all.filter((p) => p.patternId === ex.patternId);
      expect(forPattern.length).toBe(ex.prompts.length);
      expect(forPattern.map((p) => p.prompt).sort()).toEqual([...ex.prompts].sort());
      count += ex.prompts.length;
    }
    expect(all.length).toBe(count);
  });

  it("getExamplesByLevel returns only that level", () => {
    expect(getExamplesByLevel("intra").every((e) => e.level === "intra")).toBe(true);
    expect(getExamplesByLevel("workflow").every((e) => e.level === "workflow")).toBe(true);
    expect(getExamplesByLevel("meta").every((e) => e.level === "meta")).toBe(true);
    expect(getExamplesByLevel("intra").length + getExamplesByLevel("workflow").length + getExamplesByLevel("meta").length).toBe(
      AGENT_PATTERN_EXAMPLES.length
    );
  });
});
