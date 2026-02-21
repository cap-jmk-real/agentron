import { describe, it, expect } from "vitest";
import {
  llmContextPrefix,
  normalizeChatError,
  normalizeOptionsWithLLM,
  normalizeAskUserOptionsInToolResults,
  extractOptionsFromContentWithLLM,
  hasWaitingForInputInToolResults,
  hasFormatResponseWithContent,
  deriveInteractivePromptFromContentWithLLM,
  getTurnStatusFromToolResults,
  normalizeOptionCountInContent,
  getAssistantDisplayContent,
  buildSpecialistSummaryWithCreatedIds,
  getCreatedIdsFromToolResults,
  mergeCreatedIdsIntoPlan,
} from "../../../app/api/_lib/chat-helpers";

describe("chat-helpers", () => {
  describe("llmContextPrefix", () => {
    it("includes provider and model", () => {
      expect(llmContextPrefix({ provider: "openai", model: "gpt-4" })).toBe(
        "[Provider: openai, Model: gpt-4] "
      );
    });

    it("includes endpoint when present and non-empty", () => {
      expect(
        llmContextPrefix({ provider: "openai", model: "gpt-4", endpoint: "https://api.example.com" })
      ).toBe("[Provider: openai, Model: gpt-4, Endpoint: https://api.example.com] ");
    });

    it("omits endpoint when empty string", () => {
      expect(llmContextPrefix({ provider: "x", model: "y", endpoint: "" })).toBe(
        "[Provider: x, Model: y] "
      );
    });

    it("omits endpoint when only whitespace", () => {
      expect(llmContextPrefix({ provider: "x", model: "y", endpoint: "   " })).toBe(
        "[Provider: x, Model: y] "
      );
    });
  });

  describe("normalizeChatError", () => {
    it("returns generic message for network-style errors", () => {
      expect(normalizeChatError(new Error("fetch failed"))).toContain(
        "Could not reach the LLM"
      );
      expect(normalizeChatError(new Error("ECONNREFUSED"))).toContain(
        "Could not reach the LLM"
      );
      expect(normalizeChatError(new Error("ENOTFOUND"))).toContain(
        "Could not reach the LLM"
      );
      expect(normalizeChatError(new Error("network error"))).toContain(
        "Could not reach the LLM"
      );
    });

    it("appends tool execution hint for Cannot convert undefined or null to object", () => {
      const msg = normalizeChatError(
        new Error("Cannot convert undefined or null to object")
      );
      expect(msg).toContain("tool execution bug");
      expect(msg).toContain("Cannot convert undefined or null to object");
    });

    it("passes through other errors unchanged when no context", () => {
      expect(normalizeChatError(new Error("Something else"))).toBe("Something else");
    });

    it("prefixes with llm context when provided", () => {
      const out = normalizeChatError(new Error("fetch failed"), {
        provider: "openai",
        model: "gpt-4",
      });
      expect(out).toContain("[Provider: openai, Model: gpt-4] ");
      expect(out).toContain("Could not reach the LLM");
    });

    it("appends OpenAI docs link for openai provider and 404 in message", () => {
      const out = normalizeChatError(new Error("404 Not Found"), {
        provider: "openai",
        model: "gpt-4",
      });
      expect(out).toContain("platform.openai.com/docs/api-reference");
      expect(out).toContain("platform.openai.com/docs/overview");
    });

    it("does not append OpenAI docs for non-openai provider with 404", () => {
      const out = normalizeChatError(new Error("404"), {
        provider: "openrouter",
        model: "gpt-4",
      });
      expect(out).not.toContain("platform.openai.com");
    });

    it("handles non-Error throwables", () => {
      expect(normalizeChatError("string error")).toBe("string error");
    });
  });

  describe("normalizeOptionsWithLLM", () => {
    it("returns parsed JSON array when callLLM returns valid array", async () => {
      const callLLM = async () => '["Run it now", "Modify", "Not now"]';
      const out = await normalizeOptionsWithLLM(callLLM, ["Run it now", "Modify", "Not now"]);
      expect(out).toEqual(["Run it now", "Modify", "Not now"]);
    });

    it("returns original options when callLLM throws", async () => {
      const callLLM = async () => {
        throw new Error("Network error");
      };
      const options = ["A", "B"];
      const out = await normalizeOptionsWithLLM(callLLM, options);
      expect(out).toEqual(options);
    });

    it("returns original options when response is not valid JSON array", async () => {
      const callLLM = async () => "Here are the options: A, B";
      const options = ["A", "B"];
      const out = await normalizeOptionsWithLLM(callLLM, options);
      expect(out).toEqual(options);
    });

    it("returns empty array when input is empty", async () => {
      const callLLM = async () => "[]";
      const out = await normalizeOptionsWithLLM(callLLM, []);
      expect(out).toEqual([]);
    });
  });

  describe("normalizeAskUserOptionsInToolResults", () => {
    it("normalizes ask_user options via callLLM and returns new array", async () => {
      const callLLM = async () => '["Yes", "No"]';
      const toolResults = [
        { name: "ask_user", args: {}, result: { question: "Confirm?", options: ["Yes", "No"] } },
      ];
      const out = await normalizeAskUserOptionsInToolResults(toolResults, callLLM);
      expect(out).toHaveLength(1);
      expect((out[0].result as { options?: string[] }).options).toEqual(["Yes", "No"]);
    });

    it("leaves other tool results unchanged", async () => {
      const callLLM = async () => "[]";
      const toolResults = [
        { name: "list_workflows", args: {}, result: [] },
        { name: "ask_user", args: {}, result: { question: "Which?", options: ["A", "B"] } },
      ];
      const out = await normalizeAskUserOptionsInToolResults(toolResults, callLLM);
      expect(out).toHaveLength(2);
      expect(out[0].name).toBe("list_workflows");
      expect(out[1].name).toBe("ask_user");
    });

    it("leaves ask_user without options unchanged", async () => {
      const callLLM = async () => "[]";
      const toolResults = [{ name: "ask_user", args: {}, result: { question: "What?" } }];
      const out = await normalizeAskUserOptionsInToolResults(toolResults, callLLM);
      expect(out).toHaveLength(1);
      expect((out[0].result as { question: string }).question).toBe("What?");
    });
  });

  describe("extractOptionsFromContentWithLLM", () => {
    it("returns null when content does not suggest options", async () => {
      // No heuristics; LLM is always called for long enough content. Mock returns [] when no options.
      const callLLM = async () => "[]";
      expect(await extractOptionsFromContentWithLLM("Just a normal message.", callLLM)).toBeNull();
      expect(await extractOptionsFromContentWithLLM("", callLLM)).toBeNull();
    });

    it("returns parsed options when content has pick one and callLLM returns JSON array", async () => {
      const callLLM = async () => '["Run it now", "Provide credentials", "Dry run only"]';
      const content = "Please pick one option: Run it now — start the workflow. Provide credentials — ...";
      const out = await extractOptionsFromContentWithLLM(content, callLLM);
      expect(out).toEqual(["Run it now", "Provide credentials", "Dry run only"]);
    });

    it("returns null when callLLM throws", async () => {
      const callLLM = async () => {
        throw new Error("fail");
      };
      const content = "Please pick one option: a) Yes b) No";
      expect(await extractOptionsFromContentWithLLM(content, callLLM)).toBeNull();
    });

    it("falls back to bullet-list extraction when LLM returns [] and content has options list", async () => {
      const callLLM = async () => "[]";
      const content = `Summary: Workflow updated.

What would you like me to do next?
- Run it now (I will execute the workflow and report results).
- Change vault policy to "Auto-use vault creds" before running.
- Modify the agent or workflow (tell me what to change).
- Not now / stop.`;
      const out = await extractOptionsFromContentWithLLM(content, callLLM);
      expect(out).toEqual([
        "Run it now (I will execute the workflow and report results).",
        "Change vault policy to \"Auto-use vault creds\" before running.",
        "Modify the agent or workflow (tell me what to change).",
        "Not now / stop.",
      ]);
    });
  });

  describe("hasWaitingForInputInToolResults", () => {
    it("returns true for ask_user with waitingForUser true", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "ask_user", result: { waitingForUser: true, question: "Confirm?" } },
        ])
      ).toBe(true);
    });

    it("returns true for ask_user with options array", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "ask_user", result: { question: "Pick one", options: ["A", "B"] } },
        ])
      ).toBe(true);
    });

    it("returns true for ask_credentials with waitingForUser", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "ask_credentials", result: { waitingForUser: true, credentialKey: "key" } },
        ])
      ).toBe(true);
    });

    it("returns true for format_response with formatted and needsInput", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "format_response", result: { formatted: true, needsInput: "Choose an option" } },
        ])
      ).toBe(true);
    });

    it("returns false for ask_user without waitingForUser or options", () => {
      expect(
        hasWaitingForInputInToolResults([{ name: "ask_user", result: { question: "Open question" } }])
      ).toBe(false);
    });

    it("returns false for format_response without formatted or needsInput", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "format_response", result: { formatted: true } },
        ])
      ).toBe(false);
      expect(
        hasWaitingForInputInToolResults([
          { name: "format_response", result: { needsInput: "x" } },
        ])
      ).toBe(false);
    });

    it("returns false for empty or non-waiting tool results", () => {
      expect(hasWaitingForInputInToolResults([])).toBe(false);
      expect(
        hasWaitingForInputInToolResults([{ name: "list_workflows", result: [] }])
      ).toBe(false);
    });
  });

  describe("hasFormatResponseWithContent", () => {
    it("returns true when format_response has non-empty summary", () => {
      expect(
        hasFormatResponseWithContent([{ name: "format_response", result: { summary: "Done." } }])
      ).toBe(true);
    });

    it("returns true when format_response has non-empty needsInput", () => {
      expect(
        hasFormatResponseWithContent([{ name: "format_response", result: { needsInput: "Pick one" } }])
      ).toBe(true);
    });

    it("returns false when format_response is absent", () => {
      expect(hasFormatResponseWithContent([{ name: "ask_user", result: {} }])).toBe(false);
    });

    it("returns false when format_response has empty summary and needsInput", () => {
      expect(
        hasFormatResponseWithContent([{ name: "format_response", result: { summary: "", needsInput: "" } }])
      ).toBe(false);
    });
  });

  describe("getAssistantDisplayContent", () => {
    it("returns content when content is non-empty (e.g. heap summary)", () => {
      const summary = "I've created the workflow and wired the agents. You can run it now.";
      expect(getAssistantDisplayContent(summary, [])).toBe(summary);
      expect(getAssistantDisplayContent(summary, [{ name: "list_tools", args: {}, result: [] }])).toBe(summary);
    });

    it("returns ask_user question when content is empty and ask_user present", () => {
      const toolResults = [
        { name: "ask_user", args: {}, result: { question: "Which option?", options: ["A", "B"] } },
      ];
      expect(getAssistantDisplayContent("", toolResults)).toBe("Which option?");
    });

    it("returns format_response summary when formatted and no long content", () => {
      const toolResults = [
        {
          name: "format_response",
          args: {},
          result: { formatted: true, summary: "Workflow created.", needsInput: "" },
        },
      ];
      expect(getAssistantDisplayContent("", toolResults)).toBe("Workflow created.");
    });
  });

  describe("deriveInteractivePromptFromContentWithLLM", () => {
    it("returns question and options when callLLM returns valid JSON", async () => {
      const callLLM = async () => '{"question":"Next steps","options":["A","B","C"]}';
      const longContent =
        "Summary of the questionnaire and instructions.\n\nNext steps (pick one): A, B, or C.";
      const res = await deriveInteractivePromptFromContentWithLLM(longContent, callLLM);
      expect(res).toEqual({ question: "Next steps", options: ["A", "B", "C"] });
    });

    it("returns null when content too short", async () => {
      const callLLM = async () => "{}";
      const res = await deriveInteractivePromptFromContentWithLLM("Hi", callLLM);
      expect(res).toBeNull();
    });

    it("returns null when callLLM returns invalid JSON", async () => {
      const callLLM = async () => "not json";
      const res = await deriveInteractivePromptFromContentWithLLM(
        "Long message with next steps here.",
        callLLM
      );
      expect(res).toBeNull();
    });

    it("returns null when options length is not 2-4", async () => {
      const callLLM = async () => '{"question":"Q","options":["only one"]}';
      const res = await deriveInteractivePromptFromContentWithLLM("Long message.", callLLM);
      expect(res).toBeNull();
    });
  });

  describe("getTurnStatusFromToolResults", () => {
    it("returns first ask_user when useLastAskUser not set", () => {
      const toolResults = [
        { name: "ask_user", args: {}, result: { waitingForUser: true, question: "First?", options: ["A", "B"] } },
        { name: "ask_user", args: {}, result: { waitingForUser: true, question: "Last?", options: ["X", "Y", "Z"] } },
      ];
      const out = getTurnStatusFromToolResults(toolResults);
      expect(out.status).toBe("waiting_for_input");
      expect(out.interactivePrompt?.question).toBe("First?");
      expect(out.interactivePrompt?.options).toEqual(["A", "B"]);
    });

    it("returns last ask_user when useLastAskUser true", () => {
      const toolResults = [
        { name: "ask_user", args: {}, result: { waitingForUser: true, question: "First?", options: ["A", "B"] } },
        { name: "ask_user", args: {}, result: { waitingForUser: true, question: "Last?", options: ["X", "Y", "Z"] } },
      ];
      const out = getTurnStatusFromToolResults(toolResults, { useLastAskUser: true });
      expect(out.status).toBe("waiting_for_input");
      expect(out.interactivePrompt?.question).toBe("Last?");
      expect(out.interactivePrompt?.options).toEqual(["X", "Y", "Z"]);
    });

    it("returns completed when no ask_user", () => {
      const out = getTurnStatusFromToolResults([{ name: "list_agents", args: {}, result: [] }]);
      expect(out.status).toBe("completed");
      expect(out.interactivePrompt).toBeUndefined();
    });
  });

  describe("normalizeOptionCountInContent", () => {
    it("replaces digit option count with actual count", () => {
      expect(normalizeOptionCountInContent("pick one of the 4 options above", 3)).toBe(
        "pick one of the 3 options above"
      );
    });

    it("replaces one of the X options with actual count", () => {
      expect(normalizeOptionCountInContent("Choose one of the 4 options.", 3)).toBe(
        "Choose one of the 3 options."
      );
    });

    it("leaves content unchanged when actualCount is invalid", () => {
      const content = "pick one of the 4 options";
      expect(normalizeOptionCountInContent(content, -1)).toBe(content);
      expect(normalizeOptionCountInContent(content, 1.5)).toBe(content);
    });

    it("uses singular option when actualCount is 1", () => {
      expect(normalizeOptionCountInContent("Pick one of the 2 options", 1)).toBe(
        "Pick one of the 1 option"
      );
    });
  });

  describe("buildSpecialistSummaryWithCreatedIds", () => {
    it("appends [Created workflow id: <uuid>] when create_workflow is in tool results", () => {
      const wfId = "ff2cb7fe-bc5f-427e-ba9c-7cb971dee20c";
      const summary = buildSpecialistSummaryWithCreatedIds("Done.", [
        { name: "create_workflow", result: { id: wfId, name: "Test WF", message: "Created" } },
      ]);
      expect(summary).toContain("[Created workflow id: " + wfId + "]");
    });

    it("appends [Created agent id: <uuid>] when create_agent is in tool results", () => {
      const agentId = "60a658ca-2a22-4fc9-b0ff-9f206d5d51b8";
      const summary = buildSpecialistSummaryWithCreatedIds("Done.", [
        { name: "create_agent", result: { id: agentId, name: "Test Agent", message: "Created" } },
      ]);
      expect(summary).toContain("[Created agent id: " + agentId + "]");
    });

    it("appends both when create_workflow and create_agent are in tool results", () => {
      const wfId = "wf-uuid-1";
      const agentId = "agent-uuid-1";
      const summary = buildSpecialistSummaryWithCreatedIds("Summary", [
        { name: "create_agent", result: { id: agentId } },
        { name: "create_workflow", result: { id: wfId } },
      ]);
      expect(summary).toContain("[Created agent id: " + agentId + "]");
      expect(summary).toContain("[Created workflow id: " + wfId + "]");
    });

    it("does not append when result has no id or wrong shape", () => {
      const summary = buildSpecialistSummaryWithCreatedIds("Done.", [
        { name: "create_workflow", result: {} },
        { name: "create_workflow", result: { name: "X" } },
      ]);
      expect(summary).toBe("Done.");
    });
  });

  describe("getCreatedIdsFromToolResults", () => {
    it("returns workflowId and agentId from create_workflow and create_agent results", () => {
      const wfId = "ff2cb7fe-bc5f-427e-ba9c-7cb971dee20c";
      const agentId = "60a658ca-2a22-4fc9-b0ff-9f206d5d51b8";
      const out = getCreatedIdsFromToolResults([
        { name: "create_workflow", result: { id: wfId } },
        { name: "create_agent", result: { id: agentId } },
      ]);
      expect(out.workflowId).toBe(wfId);
      expect(out.agentId).toBe(agentId);
    });

    it("returns empty when no create_workflow/create_agent or no id in result", () => {
      expect(getCreatedIdsFromToolResults([])).toEqual({});
      expect(getCreatedIdsFromToolResults([{ name: "create_workflow", result: {} }])).toEqual({});
    });
  });

  describe("mergeCreatedIdsIntoPlan", () => {
    it("merges workflowId and agentId from tool results into plan extractedContext", () => {
      const wfId = "wf-uuid-1";
      const agentId = "agent-uuid-1";
      const plan = { refinedTask: "Create and run", priorityOrder: ["agent", "workflow"], extractedContext: { savedSearchId: "123" } };
      const toolResults = [
        { name: "create_agent", result: { id: agentId } },
        { name: "create_workflow", result: { id: wfId } },
      ];
      const merged = mergeCreatedIdsIntoPlan(plan, toolResults);
      expect(merged.extractedContext).toEqual({ savedSearchId: "123", workflowId: wfId, agentId });
    });

    it("returns plan unchanged when no create_workflow/create_agent ids in tool results", () => {
      const plan = { refinedTask: "Run", extractedContext: { a: 1 } };
      expect(mergeCreatedIdsIntoPlan(plan, [])).toBe(plan);
      expect(mergeCreatedIdsIntoPlan(plan, [{ name: "ask_user", result: {} }])).toBe(plan);
    });
  });
});
