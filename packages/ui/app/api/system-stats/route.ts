import { json } from "../_lib/response";
import { getCachedSystemStats } from "../_lib/system-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns current system resource usage (CPU, RAM, disk, GPU/VRAM). Cached ~1.2s so multiple tabs don't each run PowerShell/nvidia-smi. */
export async function GET() {
  const snapshot = getCachedSystemStats();
  return json(snapshot);
}
