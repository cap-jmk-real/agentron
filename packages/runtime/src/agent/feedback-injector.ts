import type { Feedback } from "@agentron-studio/core";

export type FeedbackLoader = (targetId: string, limit?: number) => Promise<Feedback[]>;

/**
 * Builds a prompt injection block from labeled feedback.
 * Prepend the returned string to the system prompt before calling the LLM.
 */
export function buildFeedbackInjection(items: Feedback[]): string {
  if (!items.length) return "";

  const lines: string[] = [
    "## Learning from past runs",
    "The user has labeled previous outputs. Use these to improve your responses.\n",
  ];

  for (const fb of items) {
    const inputStr = typeof fb.input === "string" ? fb.input : JSON.stringify(fb.input, null, 2);
    const outputStr =
      typeof fb.output === "string" ? fb.output : JSON.stringify(fb.output, null, 2);
    const tag = fb.label.toUpperCase();

    lines.push(`### ${tag} example${fb.notes ? ` (user note: "${fb.notes}")` : ""}:`);
    lines.push(`Input: ${inputStr}`);
    lines.push(`Output: ${outputStr}`);

    if (fb.label === "bad" && fb.notes) {
      lines.push(`Avoid repeating this mistake.`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Loads feedback for a target and returns the injection string.
 * The loader callback keeps the runtime decoupled from the database.
 */
export async function injectFeedback(
  loader: FeedbackLoader,
  targetId: string,
  limit = 10
): Promise<string> {
  const items = await loader(targetId, limit);
  return buildFeedbackInjection(items);
}
