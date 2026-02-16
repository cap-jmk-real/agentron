import { json } from "../../_lib/response";
import { db, vaultMeta, llmConfigs } from "../../_lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/** GET /api/setup/status — returns { vaultExists, hasLlmProvider } for first-launch / setup flow. */
export async function GET() {
  const [vaultRows, llmRows] = await Promise.all([
    db.select().from(vaultMeta).where(eq(vaultMeta.id, "default")),
    db.select().from(llmConfigs),
  ]);
  const vaultExists = vaultRows.length > 0;
  const hasLlmProvider = llmRows.length > 0;
  return json({ vaultExists, hasLlmProvider });
}
