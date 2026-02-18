/**
 * Per-conversation serialization: only one chat turn runs per conversation at a time.
 * Uses conversation_locks table so state survives restarts and is visible on the Queues page.
 */
import { eq } from "drizzle-orm";
import { db, conversationLocks } from "./db";

const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 20;
const STALE_LOCK_MS = 5 * 60 * 1000;

async function acquireLock(conversationId: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const rows = await db.select().from(conversationLocks).where(eq(conversationLocks.conversationId, conversationId));
    if (rows.length > 0) {
      const row = rows[0];
      if (row.startedAt < Date.now() - STALE_LOCK_MS) {
        await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, conversationId)).run();
      } else {
        await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
      }
      continue;
    }
    const now = Date.now();
    try {
      await db.insert(conversationLocks).values({ conversationId, startedAt: now, createdAt: now }).run();
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/UNIQUE|unique|SqliteError.*primary/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
  throw new Error("Timeout waiting for conversation lock");
}

async function releaseLock(conversationId: string): Promise<void> {
  await Promise.resolve(db.delete(conversationLocks).where(eq(conversationLocks.conversationId, conversationId)).run());
}

/**
 * Run the given handler serially per conversationId. Acquires a DB lock (conversation_locks)
 * before running; releases in finally so the next turn can run. If a previous turn is still
 * running, this one waits up to LOCK_WAIT_MS. Stale locks (older than 5 min) are removed.
 */
export async function runSerializedByConversation<T>(conversationId: string, handler: () => Promise<T>): Promise<T> {
  await acquireLock(conversationId);
  try {
    return await handler();
  } finally {
    await releaseLock(conversationId);
  }
}
