/**
 * Credential storage: internal vault only. Credentials are encrypted with the key
 * derived from the user's master password. The agent can only read or save credentials
 * when the vault is unlocked (vault key provided). No keychain, no fallbacks.
 */

import { db, savedCredentials } from "./db";
import { eq } from "drizzle-orm";
import { encryptWithVaultKey, decryptWithVaultKey } from "./vault";

/**
 * Retrieves a stored credential. Requires the vault to be unlocked (vaultKey from cookie).
 * Returns null if vault is locked or credential not found.
 */
export async function getStoredCredential(
  credentialKey: string,
  vaultKey: Buffer | null
): Promise<string | null> {
  if (!vaultKey) return null;
  const key = credentialKey.trim().toLowerCase().replace(/\s+/g, "_") || null;
  if (!key) return null;

  const rows = await db.select().from(savedCredentials).where(eq(savedCredentials.key, key));
  if (rows.length === 0 || !rows[0]?.value) return null;
  try {
    return decryptWithVaultKey(rows[0].value, vaultKey);
  } catch {
    return null;
  }
}

/**
 * Saves a credential. Requires the vault to be unlocked. If vault is locked, does nothing.
 */
export async function setStoredCredential(
  credentialKey: string,
  value: string,
  save: boolean,
  vaultKey: Buffer | null
): Promise<void> {
  if (!save || !value.trim() || !vaultKey) return;
  const key = credentialKey.trim().toLowerCase().replace(/\s+/g, "_") || "credential";
  const plaintext = value.trim();
  const encrypted = encryptWithVaultKey(plaintext, vaultKey);
  await db.insert(savedCredentials).values({ key, value: encrypted, createdAt: Date.now() })
    .onConflictDoUpdate({ target: savedCredentials.key, set: { value: encrypted, createdAt: Date.now() } }).run();
}
