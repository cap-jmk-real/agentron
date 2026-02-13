/**
 * Per-conversation serialization: only one chat turn runs per conversation at a time.
 * Ensures message N+1 waits for message N to finish so the assistant has correct context.
 */
const conversationTails = new Map<string, Promise<void>>();

/**
 * Run the given handler serially per conversationId. If a previous turn for this
 * conversation is still running, this one waits for it to finish before starting.
 */
export async function runSerializedByConversation<T>(conversationId: string, handler: () => Promise<T>): Promise<T> {
  const prev = conversationTails.get(conversationId) ?? Promise.resolve();
  let resolveNext: () => void;
  const next = new Promise<void>((r) => {
    resolveNext = r;
  });
  conversationTails.set(conversationId, next);

  try {
    await prev;
    return await handler();
  } finally {
    resolveNext!();
    if (conversationTails.get(conversationId) === next) {
      conversationTails.delete(conversationId);
    }
  }
}
