import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { formatToolNotAvailableError } from "../../../../app/api/chat/_lib/chat-route-heap";

/** Regression: general specialist must report workflow outcome (success or failure) when workflow_design already ran execute_workflow. */
const GENERAL_PROMPT_WORKFLOW_RAN_INSTRUCTION =
  "When Previous steps show that workflow_design already ran execute_workflow in this turn";

describe("chat-route-heap", () => {
  describe("general specialist prompt", () => {
    it("instructs general to report workflow outcome when workflow_design already ran execute_workflow", () => {
      const heapPath = join(__dirname, "../../../../app/api/chat/_lib/chat-route-heap.ts");
      const source = readFileSync(heapPath, "utf-8");
      expect(source).toContain(GENERAL_PROMPT_WORKFLOW_RAN_INSTRUCTION);
      expect(source).toContain("do NOT say the workflow cannot be run");
      expect(source).toContain("If it completed successfully");
      expect(source).toContain("If it failed");
      expect(source).toContain("report the failure");
    });
  });

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
