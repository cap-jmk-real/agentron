import type { RateLimitConfig } from "./rate-limits";
import type { LLMRequestContext } from "./types";

const WINDOW_MS = 60_000;
const RECENT_DELAYED_MAX = 200;
const MIN_WAIT_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TokenEntry {
  ts: number;
  tokens: number;
}

interface KeyState {
  requestTs: number[];
  tokenEntries: TokenEntry[];
}

export type PendingEntry = {
  id: string;
  key: string;
  context: LLMRequestContext;
  addedAt: number;
};

export type DelayedEntry = {
  key: string;
  context: LLMRequestContext;
  addedAt: number;
  completedAt: number;
  waitedMs: number;
};

/** In-memory sliding-window rate limiter per key. Tracks pending (waiting) and recently delayed requests for UI. */
export class RateLimiter {
  private state = new Map<string, KeyState>();
  private pending = new Map<string, PendingEntry>();
  private recentDelayed: DelayedEntry[] = [];
  private nextId = 0;

  private getState(key: string): KeyState {
    let s = this.state.get(key);
    if (!s) {
      s = { requestTs: [], tokenEntries: [] };
      this.state.set(key, s);
    }
    return s;
  }

  private trim(state: KeyState, now: number): void {
    const cutoff = now - WINDOW_MS;
    state.requestTs = state.requestTs.filter((ts) => ts > cutoff);
    state.tokenEntries = state.tokenEntries.filter((e) => e.ts > cutoff);
  }

  /**
   * Wait until a request is allowed under the limits. Optional context is used for queue visibility (pending/delayed).
   */
  async acquire(key: string, limits: RateLimitConfig, context?: LLMRequestContext): Promise<void> {
    const ctx = context ?? { source: "chat" as const };
    const id = `pending-${++this.nextId}`;
    const addedAt = Date.now();
    this.pending.set(id, { id, key, context: ctx, addedAt });
    try {
      const { requestsPerMinute: rpm, tokensPerMinute: tpm } = limits;
      const state = this.getState(key);

      while (true) {
        const now = Date.now();
        this.trim(state, now);

        const atRpmLimit = state.requestTs.length >= rpm;
        const tokenSum = state.tokenEntries.reduce((s, e) => s + e.tokens, 0);
        const atTpmLimit = tpm != null && tpm > 0 && tokenSum >= tpm;

        if (!atRpmLimit && !atTpmLimit) {
          state.requestTs.push(now);
          return;
        }

        const waitForRpm =
          atRpmLimit && state.requestTs.length > 0
            ? state.requestTs[0] + WINDOW_MS - now
            : Infinity;
        const waitForTpm =
          atTpmLimit && state.tokenEntries.length > 0
            ? state.tokenEntries[0].ts + WINDOW_MS - now
            : Infinity;
        const waitMs = Math.max(0, Math.ceil(Math.min(waitForRpm, waitForTpm)));
        if (waitMs <= 0) continue;
        await sleep(Math.min(waitMs, 5000));
      }
    } finally {
      this.pending.delete(id);
      const waitedMs = Date.now() - addedAt;
      if (waitedMs >= MIN_WAIT_MS) {
        this.recentDelayed.push({ key, context: ctx, addedAt, completedAt: Date.now(), waitedMs });
        if (this.recentDelayed.length > RECENT_DELAYED_MAX) this.recentDelayed.shift();
      }
    }
  }

  /** Call after a request completes to record token usage for TPM limiting. */
  recordTokens(key: string, tokens: number): void {
    if (tokens <= 0) return;
    const state = this.getState(key);
    state.tokenEntries.push({ ts: Date.now(), tokens });
    this.trim(state, Date.now());
  }

  getPending(): PendingEntry[] {
    return Array.from(this.pending.values());
  }

  getRecentDelayed(): DelayedEntry[] {
    return [...this.recentDelayed];
  }
}

let defaultLimiter: RateLimiter | null = null;

export function getDefaultRateLimiter(): RateLimiter {
  if (!defaultLimiter) defaultLimiter = new RateLimiter();
  return defaultLimiter;
}
