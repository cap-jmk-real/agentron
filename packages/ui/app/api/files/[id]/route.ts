import { json } from "../../_lib/response";
import { db, files, fromFileRow, ensureFilesDir } from "../../_lib/db";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(files).where(eq(files.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const file = fromFileRow(rows[0]);

  const query = new URL(_.url).searchParams;
  if (query.get("meta") === "true") {
    return json(file);
  }

  const filesDir = ensureFilesDir();
  const filePath = path.join(filesDir, file.path);
  if (!fs.existsSync(filePath)) {
    return json({ error: "File missing from disk" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Content-Length": String(file.size),
    },
  });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(files).where(eq(files.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const file = fromFileRow(rows[0]);

  const filesDir = ensureFilesDir();
  const filePath = path.join(filesDir, file.path);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await db.delete(files).where(eq(files.id, id)).run();
  return json({ ok: true });
}
