import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runRestore } from "../../_lib/db";
import { json } from "../../_lib/response";

export const runtime = "nodejs";

/** Restore database from an uploaded backup file. Replaces current data; refresh the app after restore. */
export async function POST(request: Request) {
  let tempPath: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("backup");
    if (!file || typeof file === "string") {
      return json({ error: "No file uploaded. Use form field 'file' or 'backup'." }, { status: 400 });
    }
    const blob = file as Blob;
    const buffer = Buffer.from(await blob.arrayBuffer());
    tempPath = path.join(os.tmpdir(), `agentron-restore-${Date.now()}.sqlite`);
    fs.writeFileSync(tempPath, buffer);
    await runRestore(tempPath);
    return json({ ok: true, message: "Restore complete. Refresh the app to see restored data." });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Restore failed";
    return json({ error: message }, { status: 500 });
  } finally {
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
  }
}
