import { describe, it, expect } from "vitest";
import { IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE } from "../../app/api/chat/route";

describe("improve_agents_workflows specialist prompt", () => {
  it("IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE contains cannot create and do not ask for creation parameters", () => {
    expect(IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE).toContain("cannot create");
    expect(IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE).toMatch(
      /do not ask.*creation parameters|creation parameters/i
    );
  });
});
