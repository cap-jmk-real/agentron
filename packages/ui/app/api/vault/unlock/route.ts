import { json } from "../../_lib/response";
import { db, vaultMeta } from "../../_lib/db";
import { eq } from "drizzle-orm";
import {
  deriveVaultKey,
  decryptWithVaultKey,
  buildVaultCookieHeader,
} from "../../_lib/vault";

export const runtime = "nodejs";

const VAULT_CHECK_PLAIN = "vault_ok";

/** POST /api/vault/unlock — unlock vault with master password. Body: { masterPassword }. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const masterPassword = typeof body.masterPassword === "string" ? body.masterPassword : "";
  if (!masterPassword.trim()) {
    return json({ error: "masterPassword required" }, { status: 400 });
  }

  const rows = await db.select().from(vaultMeta).where(eq(vaultMeta.id, "default"));
  if (rows.length === 0) {
    return json({ error: "Vault does not exist. Create it first." }, { status: 400 });
  }

  const row = rows[0]!;
  const key = deriveVaultKey(masterPassword.trim(), row.salt);
  let verified: string;
  try {
    verified = decryptWithVaultKey(row.check, key);
  } catch {
    return json({ error: "Invalid master password" }, { status: 401 });
  }
  if (verified !== VAULT_CHECK_PLAIN) {
    return json({ error: "Invalid master password" }, { status: 401 });
  }

  const cookieHeader = buildVaultCookieHeader(key);
  return json({ ok: true }, {
    headers: { "Set-Cookie": cookieHeader },
  });
}
