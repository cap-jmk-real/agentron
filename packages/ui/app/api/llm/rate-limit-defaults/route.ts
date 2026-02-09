import { json } from "../../_lib/response";
import { DEFAULT_RATE_LIMITS } from "@agentron-studio/runtime";

export const runtime = "nodejs";

/** Returns default rate limits per provider (used by LLM settings UI). */
export async function GET() {
  return json(DEFAULT_RATE_LIMITS);
}
