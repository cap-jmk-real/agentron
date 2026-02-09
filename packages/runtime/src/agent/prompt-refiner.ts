import type { Feedback } from "@agentron-studio/core";
import type { LLMRequest, LLMResponse } from "../llm/types";

export type LLMCaller = (request: LLMRequest) => Promise<LLMResponse>;

export interface RefineInput {
  currentSystemPrompt: string;
  currentSteps?: { name: string; type: string; content: string }[];
  feedback: Feedback[];
}

export interface RefineResult {
  suggestedSystemPrompt: string;
  suggestedSteps?: { name: string; type: string; content: string }[];
  reasoning: string;
}

/**
 * Uses an LLM to analyze feedback and suggest improvements to the agent's prompt.
 */
export async function refinePrompt(
  input: RefineInput,
  callLLM: LLMCaller
): Promise<RefineResult> {
  const goodCount = input.feedback.filter((f) => f.label === "good").length;
  const badCount = input.feedback.filter((f) => f.label === "bad").length;

  const badNotes = input.feedback
    .filter((f) => f.label === "bad" && f.notes)
    .map((f) => `- ${f.notes}`)
    .join("\n");

  const goodNotes = input.feedback
    .filter((f) => f.label === "good" && f.notes)
    .map((f) => `- ${f.notes}`)
    .join("\n");

  const stepsText = input.currentSteps?.length
    ? input.currentSteps
        .map((s, i) => `  ${i + 1}. [${s.type}] ${s.name}: ${s.content}`)
        .join("\n")
    : "  (no steps defined)";

  const metaPrompt = `You are an expert AI prompt engineer. Analyze the feedback on an agent's performance and rewrite its system prompt and steps to improve future outputs.

Current system prompt:
${input.currentSystemPrompt || "(empty)"}

Current steps:
${stepsText}

Feedback summary:
- ${goodCount} GOOD runs, ${badCount} BAD runs
${badNotes ? `\nCommon issues in BAD runs:\n${badNotes}` : ""}
${goodNotes ? `\nWhat users liked in GOOD runs:\n${goodNotes}` : ""}

Sample BAD outputs:
${input.feedback
  .filter((f) => f.label === "bad")
  .slice(0, 3)
  .map((f) => `Input: ${JSON.stringify(f.input)}\nOutput: ${JSON.stringify(f.output)}${f.notes ? `\nNote: ${f.notes}` : ""}`)
  .join("\n---\n") || "(none)"}

Respond in this exact JSON format:
{
  "reasoning": "Brief explanation of what you changed and why",
  "suggestedSystemPrompt": "The improved system prompt",
  "suggestedSteps": [{"name": "Step name", "type": "prompt|tool_call|condition", "content": "Step instruction"}]
}

Only output valid JSON, nothing else.`;

  const response = await callLLM({
    messages: [{ role: "user", content: metaPrompt }],
    temperature: 0.3,
  });

  try {
    const parsed = JSON.parse(response.content);
    return {
      suggestedSystemPrompt: parsed.suggestedSystemPrompt ?? input.currentSystemPrompt,
      suggestedSteps: parsed.suggestedSteps,
      reasoning: parsed.reasoning ?? "No reasoning provided",
    };
  } catch {
    return {
      suggestedSystemPrompt: response.content,
      reasoning: "LLM response could not be parsed as JSON. Raw response returned as suggested prompt.",
    };
  }
}
