import { json } from "../../../_lib/response";
import { db, sandboxes, files, fromSandboxRow, fromFileRow, ensureFilesDir } from "../../../_lib/db";
import { eq } from "drizzle-orm";
import { PodmanManager } from "@agentron-studio/runtime";
import path from "node:path";

export const runtime = "nodejs";

const podman = new PodmanManager();

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, id));
  if (rows.length === 0) return json({ error: "Sandbox not found" }, { status: 404 });

  const sb = fromSandboxRow(rows[0]);
  if (!sb.containerId) return json({ error: "Sandbox has no container" }, { status: 400 });

  const payload = await request.json();
  const fileIds = payload.fileIds as string[];
  if (!fileIds?.length) return json({ error: "fileIds required" }, { status: 400 });

  const filesDir = ensureFilesDir();
  const mounted: string[] = [];

  for (const fileId of fileIds) {
    const fileRows = await db.select().from(files).where(eq(files.id, fileId));
    if (fileRows.length === 0) continue;
    const file = fromFileRow(fileRows[0]);
    const hostPath = path.join(filesDir, file.path);
    try {
      await podman.copyToContainer(sb.containerId, hostPath, `/workspace/${file.name}`);
      mounted.push(file.name);
    } catch {}
  }

  return json({ mounted });
}
