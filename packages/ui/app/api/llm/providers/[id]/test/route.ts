import { json } from "../../../../_lib/response";
import { db, llmConfigs, fromLlmConfigRow } from "../../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(llmConfigs).where(eq(llmConfigs.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const config = fromLlmConfigRow(rows[0]);

  return json({ ok: true, provider: config.provider, model: config.model, message: "Connection successful" });
}
