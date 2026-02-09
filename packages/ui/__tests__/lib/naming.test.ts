import { describe, it, expect } from "vitest";
import { randomAgentName, randomWorkflowName } from "../../app/api/_lib/naming";

describe("naming", () => {
  it("randomAgentName returns 'Word Word number' format", () => {
    const name = randomAgentName();
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d+$/);
    const parts = name.split(" ");
    expect(parts.length).toBe(3);
    const num = parseInt(parts[2], 10);
    expect(num).toBeGreaterThanOrEqual(1);
    expect(num).toBeLessThanOrEqual(9999);
  });

  it("randomWorkflowName returns 'Word workflow number' format", () => {
    const name = randomWorkflowName();
    expect(name).toMatch(/^[A-Z][a-z]+ workflow \d+$/);
    const parts = name.split(" ");
    expect(parts.length).toBe(3);
    expect(parts[1]).toBe("workflow");
  });
});
