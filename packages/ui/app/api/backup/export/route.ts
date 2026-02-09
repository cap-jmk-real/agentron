import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runBackup } from "../../_lib/db";

export const runtime = "nodejs";

/** Export a consistent backup of the database. Use for local or cloud backup (e.g. save file to Drive/Dropbox). */
export async function GET() {
  const tempPath = path.join(os.tmpdir(), `agentos-backup-${Date.now()}.sqlite`);
  try {
    await runBackup(tempPath);
    const buffer = fs.readFileSync(tempPath);
    const filename = `agentos-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}
