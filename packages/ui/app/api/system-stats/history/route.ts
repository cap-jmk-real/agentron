import { json } from "../../_lib/response";
import { getHistory } from "../../_lib/system-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns time-series of system stats (collected on each GET /api/system-stats poll). */
export async function GET() {
  return json(getHistory());
}
