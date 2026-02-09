import { json } from "../_lib/response";
import { collectSystemStats, pushHistory } from "../_lib/system-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns current system resource usage (CPU, RAM, disk, GPU/VRAM). Updates every poll. */
export async function GET() {
  const snapshot = collectSystemStats();
  pushHistory(snapshot);
  return json(snapshot);
}
