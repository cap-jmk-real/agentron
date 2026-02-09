import { json } from "../../_lib/response";
import { getDefaultRateLimiter } from "@agentron-studio/runtime";

export const runtime = "nodejs";

/** Returns currently pending (waiting) and recently delayed LLM requests for the queue UI. */
export async function GET() {
  const limiter = getDefaultRateLimiter();
  const pending = limiter.getPending();
  const recentDelayed = limiter.getRecentDelayed();
  return json({ pending, recentDelayed });
}
