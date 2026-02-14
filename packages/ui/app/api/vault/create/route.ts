import { json } from "../../_lib/response";
import { db, vaultMeta } from "../../_lib/db";
import { eq } from "drizzle-orm";
import { deriveVaultKey, encryptWithVaultKey, buildVaultCookieHeader } from "../../_lib/vault";
import crypto from "node:crypto";

export const runtime = "nodejs";

const VAULT_CHECK_PLAIN = "vault_ok";

/** POST /api/vault/create — create vault with master password (first time only). Body: { masterPassword }. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const masterPassword = typeof body.masterPassword === "string" ? body.masterPassword : "";
  if (!masterPassword.trim()) {
    return json({ error: "masterPassword required" }, { status: 400 });
  }

  const existing = await db.select().from(vaultMeta).where(eq(vaultMeta.id, "default"));
  if (existing.length > 0) {
    return json({ error: "Vault already exists. Use unlock instead." }, { status: 400 });
  }

  const salt = crypto.randomBytes(16).toString("base64url");
  const key = deriveVaultKey(masterPassword.trim(), salt);
  const check = encryptWithVaultKey(VAULT_CHECK_PLAIN, key);

  await db.insert(vaultMeta).values({
    id: "default",
    salt,
    check,
    createdAt: Date.now(),
  }).run();

  const cookieHeader = buildVaultCookieHeader(key);
  return json({ ok: true }, {
    headers: { "Set-Cookie": cookieHeader },
  });
}
