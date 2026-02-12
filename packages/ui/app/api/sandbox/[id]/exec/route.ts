import { json } from "../../../_lib/response";
import { db, sandboxes, fromSandboxRow } from "../../../_lib/db";
import { eq } from "drizzle-orm";
import { PodmanManager } from "@agentron-studio/runtime";

export const runtime = "nodejs";

const podman = new PodmanManager();

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });

  const sb = fromSandboxRow(rows[0]);
  if (!sb.containerId || sb.status !== "running") {
    return json({ error: "Sandbox not running" }, { status: 400 });
  }

  const payload = await request.json();
  const command = payload.command as string;
  if (!command) return json({ error: "command required" }, { status: 400 });

  try {
    const result = await podman.exec(sb.containerId, command);
    return json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, { status: 500 });
  }
}
