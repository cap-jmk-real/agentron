import { json } from "../../_lib/response";
import { db, vaultMeta } from "../../_lib/db";
import { eq } from "drizzle-orm";
import { getVaultKeyFromRequest } from "../../_lib/vault";

export const runtime = "nodejs";

/** GET /api/vault/status — returns { locked, vaultExists }. */
export async function GET(request: Request) {
  const rows = await db.select().from(vaultMeta).where(eq(vaultMeta.id, "default"));
  const vaultExists = rows.length > 0;
  const vaultKey = getVaultKeyFromRequest(request);
  return json({ locked: vaultKey === null, vaultExists });
}
