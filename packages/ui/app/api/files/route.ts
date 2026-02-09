import { json } from "../_lib/response";
import { db, files, toFileRow, fromFileRow, ensureFilesDir } from "../_lib/db";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(files);
  return json(rows.map(fromFileRow));
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return json({ error: "No file provided" }, { status: 400 });
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_SIZE) {
    return json({ error: "File too large (max 50MB)" }, { status: 413 });
  }

  const id = crypto.randomUUID();
  const ext = path.extname(file.name) || "";
  const storedName = `${id}${ext}`;
  const filesDir = ensureFilesDir();
  const filePath = path.join(filesDir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const entry = {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    path: storedName,
    createdAt: Date.now()
  };

  await db.insert(files).values(toFileRow(entry)).run();
  return json(entry, { status: 201 });
}
