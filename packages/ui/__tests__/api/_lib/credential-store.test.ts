import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { deriveVaultKey } from "../../../app/api/_lib/vault";
import {
  normalizeCredentialKey,
  getStoredCredential,
  setStoredCredential,
  listStoredCredentialKeys,
  updateStoredCredential,
  deleteStoredCredential,
  clearAllStoredCredentials,
} from "../../../app/api/_lib/credential-store";

describe("credential-store", () => {
  const salt = crypto.randomBytes(16).toString("base64url");
  const vaultKey = deriveVaultKey("test-master", salt);

  afterAll(async () => {
    await clearAllStoredCredentials(vaultKey);
  });

  it("normalizeCredentialKey lowercases and replaces spaces with underscores", () => {
    expect(normalizeCredentialKey("API Key")).toBe("api_key");
    expect(normalizeCredentialKey("  My Cred  ")).toBe("my_cred");
  });

  it("normalizeCredentialKey returns 'credential' for empty after trim", () => {
    expect(normalizeCredentialKey("")).toBe("credential");
    expect(normalizeCredentialKey("   ")).toBe("credential");
  });

  it("getStoredCredential returns null when vaultKey is null", async () => {
    expect(await getStoredCredential("any", null)).toBeNull();
  });

  it("getStoredCredential returns null when credentialKey is blank after trim", async () => {
    expect(await getStoredCredential("", vaultKey)).toBeNull();
    expect(await getStoredCredential("   ", vaultKey)).toBeNull();
  });

  it("getStoredCredential returns null for unknown key", async () => {
    expect(await getStoredCredential("nonexistent_key_xyz", vaultKey)).toBeNull();
  });

  it("setStoredCredential and getStoredCredential roundtrip", async () => {
    await setStoredCredential("test_cred", "secret123", true, vaultKey);
    const value = await getStoredCredential("test_cred", vaultKey);
    expect(value).toBe("secret123");
  });

  it("setStoredCredential does nothing when save is false", async () => {
    await setStoredCredential("no_save", "ignored", false, vaultKey);
    expect(await getStoredCredential("no_save", vaultKey)).toBeNull();
  });

  it("setStoredCredential does nothing when vaultKey is null", async () => {
    await setStoredCredential("locked", "secret", true, null);
    expect(await getStoredCredential("locked", vaultKey)).toBeNull();
  });

  it("setStoredCredential does nothing when value is empty or whitespace", async () => {
    await setStoredCredential("empty_val", "", true, vaultKey);
    expect(await getStoredCredential("empty_val", vaultKey)).toBeNull();
    await setStoredCredential("ws_val", "   ", true, vaultKey);
    expect(await getStoredCredential("ws_val", vaultKey)).toBeNull();
  });

  it("getStoredCredential returns null when decrypt fails", async () => {
    await setStoredCredential("decrypt_me", "secret", true, vaultKey);
    const otherSalt = crypto.randomBytes(16).toString("base64url");
    const wrongKey = deriveVaultKey("wrong-password", otherSalt);
    expect(await getStoredCredential("decrypt_me", wrongKey)).toBeNull();
  });

  it("listStoredCredentialKeys returns keys and createdAt", async () => {
    await setStoredCredential("list_cred", "v", true, vaultKey);
    const list = await listStoredCredentialKeys(vaultKey);
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((e) => e.key === "list_cred");
    expect(found).toBeDefined();
    expect(found!.createdAt).toBeGreaterThan(0);
  });

  it("listStoredCredentialKeys returns [] when vaultKey is null", async () => {
    expect(await listStoredCredentialKeys(null)).toEqual([]);
  });

  it("updateStoredCredential updates existing credential", async () => {
    await setStoredCredential("update_me", "old", true, vaultKey);
    const ok = await updateStoredCredential("update_me", "new_value", vaultKey);
    expect(ok).toBe(true);
    expect(await getStoredCredential("update_me", vaultKey)).toBe("new_value");
  });

  it("updateStoredCredential returns false when vaultKey is null", async () => {
    expect(await updateStoredCredential("k", "v", null)).toBe(false);
  });

  it("updateStoredCredential returns false when value is empty or whitespace", async () => {
    expect(await updateStoredCredential("k", "", vaultKey)).toBe(false);
    expect(await updateStoredCredential("k", "   ", vaultKey)).toBe(false);
  });

  it("deleteStoredCredential removes credential", async () => {
    await setStoredCredential("to_delete", "x", true, vaultKey);
    const ok = await deleteStoredCredential("to_delete", vaultKey);
    expect(ok).toBe(true);
    expect(await getStoredCredential("to_delete", vaultKey)).toBeNull();
  });

  it("deleteStoredCredential returns false when vaultKey is null", async () => {
    expect(await deleteStoredCredential("any", null)).toBe(false);
  });

  it("clearAllStoredCredentials returns 0 when vaultKey is null", async () => {
    expect(await clearAllStoredCredentials(null)).toBe(0);
  });
});
