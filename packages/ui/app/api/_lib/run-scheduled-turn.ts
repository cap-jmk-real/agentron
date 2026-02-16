/**
 * Runs one assistant turn for a conversation (e.g. when a reminder with taskType "assistant_task" fires).
 * The chat route registers the runner so it can use the same executeTool and context as normal chat.
 */
export type ScheduledTurnRunner = (conversationId: string, userMessageContent: string) => Promise<void>;

let runner: ScheduledTurnRunner | null = null;

export function registerScheduledTurnRunner(fn: ScheduledTurnRunner): void {
  runner = fn;
}

export async function runScheduledTurn(conversationId: string, userMessageContent: string): Promise<void> {
  if (!runner) {
    throw new Error("Scheduled turn runner not registered. Ensure the chat route has been loaded.");
  }
  await runner(conversationId, userMessageContent);
}
