import { json } from "../_lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns current process resource usage (this Node/Next.js app).
 * Used by the sidebar widget so users see how much the software is using.
 */
export async function GET() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  return json({
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
    cpu: {
      user: cpu.user,
      system: cpu.system,
    },
  });
}
