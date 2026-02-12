import { json } from "../../_lib/response";
import { db, feedback } from "../../_lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(feedback).where(eq(feedback.id, id)).run();
  return json({ ok: true });
}
