/**
 * Sum promptTokens and completionTokens from message queue steps that have usage in their payload (LLM calls).
 * Used by the queues page to show total sent/received tokens per queue.
 */
export type StepWithPayload = { payload: string | null };

export function getStepsTokenTotals(steps: StepWithPayload[]): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const s of steps) {
    if (!s.payload) continue;
    try {
      const obj = JSON.parse(s.payload) as Record<string, unknown>;
      const usage = obj?.usage;
      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        const u = usage as {
          promptTokens?: number;
          completionTokens?: number;
        };
        promptTokens += Number(u.promptTokens) || 0;
        completionTokens += Number(u.completionTokens) || 0;
      }
    } catch {
      /* ignore */
    }
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}
