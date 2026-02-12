import { json } from "../../../_lib/response";
import { db, modelPricing } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(modelPricing).where(eq(modelPricing.id, id)).run();
  return json({ ok: true });
}
