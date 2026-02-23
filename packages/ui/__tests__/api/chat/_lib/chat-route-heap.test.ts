import { describe, it, expect } from "vitest";
import { formatToolNotAvailableError } from "../../../../app/api/chat/_lib/chat-route-heap";

describe("chat-route-heap", () => {
  describe("formatToolNotAvailableError", () => {
    it("includes specialistId in error message for debugging", () => {
      const result = formatToolNotAvailableError("general", [
        "list_agents",
        "list_workflows",
        "ask_user",
      ]);
      expect(result.error).toContain("specialistId: general");
      expect(result.error).toContain("Tool not available for this specialist");
    });

    it("includes allowed tools list in error message", () => {
      const result = formatToolNotAvailableError("workflow_design", [
        "create_workflow",
        "update_workflow",
        "list_workflows",
      ]);
      expect(result.error).toContain(
        "Allowed tools: create_workflow, update_workflow, list_workflows"
      );
    });

    it("returns object with error property only", () => {
      const result = formatToolNotAvailableError("agent_lifecycle", [
        "create_agent",
        "list_agents",
      ]);
      expect(Object.keys(result)).toEqual(["error"]);
      expect(typeof result.error).toBe("string");
    });
  });
});
