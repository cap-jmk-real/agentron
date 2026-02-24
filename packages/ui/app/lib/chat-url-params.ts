/**
 * Helpers for chat page URL query params. Used by ChatSection and tested so
 * notification links (e.g. /chat?conversation=:id) correctly select the conversation.
 */

/** Returns the conversation id from search params (e.g. ?conversation=xxx). */
export function getConversationIdFromSearchParams(
  getParam: (key: string) => string | null
): string | null {
  const raw = getParam("conversation");
  return typeof raw === "string" ? raw.trim() || null : null;
}
