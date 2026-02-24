import { json } from "../../_lib/response";
import { getVaultKeyFromRequest } from "../../_lib/vault";
import { listStoredCredentialKeys } from "../../_lib/credential-store";

export const runtime = "nodejs";

/** GET /api/vault/credentials — list credential keys (no values). Requires vault unlocked. */
export async function GET(request: Request) {
  const vaultKey = getVaultKeyFromRequest(request);
  if (!vaultKey) {
    return json({ error: "Vault is locked. Unlock the vault first." }, { status: 403 });
  }
  const keys = await listStoredCredentialKeys(vaultKey);
  return json({ keys });
}
