import { describe, it, expect } from "vitest";
import { extractContentFromRawResponse } from "../../app/api/chat/route";

describe("extractContentFromRawResponse", () => {
  it("returns empty string for null or undefined", () => {
    expect(extractContentFromRawResponse(null)).toBe("");
    expect(extractContentFromRawResponse(undefined)).toBe("");
  });

  it("returns stringified value for non-object raw", () => {
    expect(extractContentFromRawResponse(42)).toBe("42");
    expect(extractContentFromRawResponse("hello")).toBe("hello");
  });

  it("extracts content from real OpenAI-style response (string content)", () => {
    const raw = {
      id: "chatcmpl-8abc123",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              '{"priorityOrder": ["agent", "workflow"], "refinedTask": "Create agent and workflow."}',
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };
    expect(extractContentFromRawResponse(raw)).toBe(
      '{"priorityOrder": ["agent", "workflow"], "refinedTask": "Create agent and workflow."}'
    );
  });

  it("extracts content from OpenAI-style response with array content (e.g. multimodal)", () => {
    const raw = {
      id: "chatcmpl-8xyz",
      choices: [
        {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "First part. " },
              { type: "text", text: "Second part." },
            ],
          },
        },
      ],
    };
    expect(extractContentFromRawResponse(raw)).toBe("First part. Second part.");
  });

  it("extracts content when content parts use text field", () => {
    const raw = {
      choices: [{ message: { content: [{ text: "A" }, { text: "B" }] } }],
    };
    expect(extractContentFromRawResponse(raw)).toBe("AB");
  });

  it("trims string content", () => {
    const raw = {
      choices: [{ message: { content: "  \n  planner output  \n  " } }],
    };
    expect(extractContentFromRawResponse(raw)).toBe("planner output");
  });

  it("returns empty string for empty choices array", () => {
    const raw = { choices: [] };
    expect(extractContentFromRawResponse(raw)).toBe("");
  });

  it("returns empty string when choices[0].message has no content", () => {
    const raw = {
      choices: [{ message: { role: "assistant" } }],
    };
    expect(extractContentFromRawResponse(raw)).toBe("");
  });

  it("returns empty string for empty object", () => {
    expect(extractContentFromRawResponse({})).toBe("");
  });

  it("handles real minimal planner-like raw (no usable content)", () => {
    const raw = {
      choices: [{ message: { content: "" } }],
    };
    expect(extractContentFromRawResponse(raw)).toBe("");
  });

  it("handles real planner raw with valid JSON in content", () => {
    const raw = {
      choices: [
        {
          message: {
            content:
              '{"priorityOrder": ["agent"], "refinedTask": "Create an agent.", "extractedContext": {}}',
          },
        },
      ],
    };
    const out = extractContentFromRawResponse(raw);
    expect(out).toContain("priorityOrder");
    expect(out).toContain("refinedTask");
    expect(out).toContain("agent");
  });
});
