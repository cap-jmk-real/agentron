import { json } from "../../../_lib/response";
import { getVaultKeyFromRequest } from "../../../_lib/vault";
import { updateStoredCredential, deleteStoredCredential, setStoredCredential } from "../../../_lib/credential-store";

export const runtime = "nodejs";

/** PATCH /api/vault/credentials/[key] — update credential value. Body: { value }. Requires vault unlocked. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const vaultKey = getVaultKeyFromRequest(request);
  if (!vaultKey) {
    return json({ error: "Vault is locked. Unlock the vault first." }, { status: 403 });
  }
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const body = (await request.json()) as { value?: string };
  const value = typeof body.value === "string" ? body.value : "";
  if (!value.trim()) {
    return json({ error: "value is required" }, { status: 400 });
  }
  const updated = await updateStoredCredential(decodedKey, value, vaultKey);
  if (!updated) {
    // Key might not exist; upsert via setStoredCredential
    await setStoredCredential(decodedKey, value, true, vaultKey);
  }
  return json({ ok: true });
}

/** DELETE /api/vault/credentials/[key] — delete one credential. Requires vault unlocked. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const vaultKey = getVaultKeyFromRequest(request);
  if (!vaultKey) {
    return json({ error: "Vault is locked. Unlock the vault first." }, { status: 403 });
  }
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const deleted = await deleteStoredCredential(decodedKey, vaultKey);
  return json({ ok: true, deleted });
}
