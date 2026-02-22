import { describe, it, expect } from "vitest";
import { resolveWorkflowIdFromArgs } from "../../../../app/api/chat/_lib/execute-tool-shared";

describe("execute-tool-shared", () => {
  describe("resolveWorkflowIdFromArgs", () => {
    it("returns workflowId when workflowId is non-empty string", () => {
      expect(resolveWorkflowIdFromArgs({ workflowId: " wf-1 " })).toEqual({
        workflowId: "wf-1",
      });
    });

    it("returns workflowId when id is used instead of workflowId", () => {
      expect(resolveWorkflowIdFromArgs({ id: "wf-2" })).toEqual({ workflowId: "wf-2" });
    });

    it("prefers workflowId over id", () => {
      expect(resolveWorkflowIdFromArgs({ workflowId: "a", id: "b" })).toEqual({
        workflowId: "a",
      });
    });

    it("returns error when direct is empty string", () => {
      expect(resolveWorkflowIdFromArgs({ workflowId: "   " })).toMatchObject({
        error: expect.stringContaining("Workflow id is required"),
      });
    });

    it("returns workflowId when workflowIdentifierField is id and value set", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "id",
          workflowIdentifierValue: " wf-3 ",
        })
      ).toEqual({ workflowId: "wf-3" });
    });

    it("returns workflowId when workflowIdentifierField is ID (case insensitive)", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "ID",
          workflowIdentifierValue: "wf-4",
        })
      ).toEqual({ workflowId: "wf-4" });
    });

    it("returns error when workflowIdentifierValue is empty", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "id",
          workflowIdentifierValue: "",
        })
      ).toMatchObject({ error: expect.stringContaining("Workflow id is required") });
    });

    it("returns error when workflowIdentifierField is not id", () => {
      expect(
        resolveWorkflowIdFromArgs({
          workflowIdentifierField: "name",
          workflowIdentifierValue: "my-workflow",
        })
      ).toMatchObject({ error: expect.stringContaining("Workflow id is required") });
    });

    it("returns error when no workflow id args provided", () => {
      expect(resolveWorkflowIdFromArgs({})).toMatchObject({
        error: expect.stringContaining("Workflow id is required"),
      });
    });
  });
});
