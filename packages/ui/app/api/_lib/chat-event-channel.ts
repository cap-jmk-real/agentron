/**
 * In-memory pub/sub channel for decoupled chat: events are published by turnId
 * and delivered to all subscribers (e.g. SSE endpoint). Used so POST can return
 * 202 immediately and the client subscribes via GET /api/chat/events?turnId=xxx.
 */

export type ChatChannelEvent = Record<string, unknown> & { type: string };

type Subscriber = (event: ChatChannelEvent) => void;

const subscribersByTurnId = new Map<string, Set<Subscriber>>();
const finishedTurnIds = new Set<string>();

/** Subscribe to events for a turn. Returns unsubscribe. */
export function subscribe(turnId: string, onEvent: Subscriber): () => void {
  if (!subscribersByTurnId.has(turnId)) {
    subscribersByTurnId.set(turnId, new Set());
  }
  subscribersByTurnId.get(turnId)!.add(onEvent);

  return () => {
    const set = subscribersByTurnId.get(turnId);
    if (set) {
      set.delete(onEvent);
      if (set.size === 0) subscribersByTurnId.delete(turnId);
    }
  };
}

/** Publish one event to all subscribers for this turnId. */
export function publish(turnId: string, event: ChatChannelEvent): void {
  const set = subscribersByTurnId.get(turnId);
  if (set) {
    for (const sub of set) {
      try {
        sub(event);
      } catch (e) {
        // Don't let one subscriber break others
      }
    }
  }
}

/** Mark turn as finished (done or error). No more events should be published. */
export function finish(turnId: string): void {
  finishedTurnIds.add(turnId);
  // Optional: cleanup subscribers after a delay to avoid memory leak
  setTimeout(() => {
    subscribersByTurnId.delete(turnId);
    finishedTurnIds.delete(turnId);
  }, 60_000);
}

export function isFinished(turnId: string): boolean {
  return finishedTurnIds.has(turnId);
}

/** Pending job: run when first subscriber connects (GET /api/chat/events). */
type PendingJob = () => Promise<void>;
const pendingJobs = new Map<string, PendingJob>();

export function setPendingJob(turnId: string, job: PendingJob): void {
  pendingJobs.set(turnId, job);
}

/** Take and remove pending job for turnId. Returns undefined if none. */
export function takePendingJob(turnId: string): PendingJob | undefined {
  const job = pendingJobs.get(turnId);
  pendingJobs.delete(turnId);
  return job;
}

export function hasPendingJob(turnId: string): boolean {
  return pendingJobs.has(turnId);
}
