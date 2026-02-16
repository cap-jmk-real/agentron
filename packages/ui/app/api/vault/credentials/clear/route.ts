import { json } from "../../../_lib/response";
import { getVaultKeyFromRequest } from "../../../_lib/vault";
import { clearAllStoredCredentials } from "../../../_lib/credential-store";

export const runtime = "nodejs";

/** POST /api/vault/credentials/clear — delete all credentials. Requires vault unlocked. */
export async function POST(request: Request) {
  const vaultKey = getVaultKeyFromRequest(request);
  if (!vaultKey) {
    return json({ error: "Vault is locked. Unlock the vault first." }, { status: 403 });
  }
  const count = await clearAllStoredCredentials(vaultKey);
  return json({ ok: true, deleted: count });
}
