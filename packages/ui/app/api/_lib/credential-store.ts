/**
 * Credential storage: internal vault only. Credentials are encrypted with the key
 * derived from the user's master password. The agent can only read or save credentials
 * when the vault is unlocked (vault key provided). No keychain, no fallbacks.
 */

import { db, savedCredentials } from "./db";
import { eq, asc } from "drizzle-orm";
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
  await db
    .insert(savedCredentials)
    .values({ key, value: encrypted, createdAt: Date.now() })
    .onConflictDoUpdate({
      target: savedCredentials.key,
      set: { value: encrypted, createdAt: Date.now() },
    })
    .run();
}

/** Normalize credential key for storage (lowercase, spaces to underscores). */
export function normalizeCredentialKey(credentialKey: string): string {
  return credentialKey.trim().toLowerCase().replace(/\s+/g, "_") || "credential";
}

/**
 * List stored credential keys (and createdAt). Does not return values. Requires vault unlocked.
 */
export async function listStoredCredentialKeys(
  vaultKey: Buffer | null
): Promise<{ key: string; createdAt: number }[]> {
  if (!vaultKey) return [];
  const rows = await db
    .select({ key: savedCredentials.key, createdAt: savedCredentials.createdAt })
    .from(savedCredentials)
    .orderBy(asc(savedCredentials.createdAt));
  return rows.map((r) => ({ key: r.key, createdAt: r.createdAt }));
}

/**
 * Update a credential value. Requires vault unlocked.
 */
export async function updateStoredCredential(
  credentialKey: string,
  value: string,
  vaultKey: Buffer | null
): Promise<boolean> {
  if (!vaultKey || !value.trim()) return false;
  const key = normalizeCredentialKey(credentialKey);
  const encrypted = encryptWithVaultKey(value.trim(), vaultKey);
  const result = await db
    .update(savedCredentials)
    .set({ value: encrypted, createdAt: Date.now() })
    .where(eq(savedCredentials.key, key))
    .run();
  return (result.changes ?? 0) > 0;
}

/**
 * Delete one stored credential by key. Requires vault unlocked.
 */
export async function deleteStoredCredential(
  credentialKey: string,
  vaultKey: Buffer | null
): Promise<boolean> {
  if (!vaultKey) return false;
  const key = normalizeCredentialKey(credentialKey);
  const result = await db.delete(savedCredentials).where(eq(savedCredentials.key, key)).run();
  return (result.changes ?? 0) > 0;
}

/**
 * Delete all stored credentials. Requires vault unlocked. Does not remove vault_meta.
 */
export async function clearAllStoredCredentials(vaultKey: Buffer | null): Promise<number> {
  if (!vaultKey) return 0;
  const result = await db.delete(savedCredentials).run();
  return result.changes ?? 0;
}
