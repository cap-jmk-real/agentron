import { json } from "../../_lib/response";
import { db, sandboxes, fromSandboxRow } from "../../_lib/db";
import { getContainerManager } from "../../_lib/container-manager";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  return json(fromSandboxRow(rows[0]));
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });

  const sb = fromSandboxRow(rows[0]);
  if (sb.containerId) {
    const podman = getContainerManager();
    try {
      await podman.destroy(sb.containerId);
    } catch {}
  }

  await db.update(sandboxes).set({ status: "destroyed" }).where(eq(sandboxes.id, id)).run();
  return json({ ok: true });
}
