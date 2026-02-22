import { describe, it, expect } from "vitest";
import {
  deriveVaultKey,
  encryptWithVaultKey,
  decryptWithVaultKey,
  decryptFromCookie,
  getVaultKeyFromRequest,
  buildVaultCookieHeader,
  buildVaultClearCookieHeader,
  VAULT_COOKIE_NAME,
} from "../../../app/api/_lib/vault";
import crypto from "node:crypto";

describe("vault", () => {
  const salt = crypto.randomBytes(16).toString("base64url");

  it("deriveVaultKey returns 32-byte buffer", () => {
    const key = deriveVaultKey("masterPassword", salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("deriveVaultKey is deterministic for same password and salt", () => {
    const a = deriveVaultKey("same", salt);
    const b = deriveVaultKey("same", salt);
    expect(a.equals(b)).toBe(true);
  });

  it("encryptWithVaultKey and decryptWithVaultKey roundtrip", () => {
    const key = deriveVaultKey("test", salt);
    const plain = "secret credential value";
    const encrypted = encryptWithVaultKey(plain, key);
    expect(encrypted).toMatch(/^enc:/);
    expect(encrypted).toContain(".");
    const decrypted = decryptWithVaultKey(encrypted, key);
    expect(decrypted).toBe(plain);
  });

  it("decryptWithVaultKey returns non-prefixed value as-is", () => {
    const key = deriveVaultKey("test", salt);
    expect(decryptWithVaultKey("plain", key)).toBe("plain");
  });

  it("decryptWithVaultKey throws for invalid ciphertext", () => {
    const key = deriveVaultKey("test", salt);
    expect(() => decryptWithVaultKey("enc:bad.parts", key)).toThrow("Invalid vault ciphertext");
  });

  it("buildVaultCookieHeader returns Set-Cookie style header with cookie name", () => {
    const key = deriveVaultKey("test", salt);
    const header = buildVaultCookieHeader(key);
    expect(header).toContain(VAULT_COOKIE_NAME + "=");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
  });

  it("buildVaultClearCookieHeader returns clear cookie", () => {
    const header = buildVaultClearCookieHeader();
    expect(header).toContain(VAULT_COOKIE_NAME + "=;");
    expect(header).toContain("Max-Age=0");
  });

  it("getVaultKeyFromRequest returns null when no cookie", () => {
    const req = new Request("http://localhost", { headers: {} });
    expect(getVaultKeyFromRequest(req)).toBeNull();
  });

  it("getVaultKeyFromRequest returns key when valid cookie present", () => {
    const key = deriveVaultKey("test", salt);
    const header = buildVaultCookieHeader(key);
    const match = header.match(/agentron_vault=([^;]+)/);
    const value = match?.[1] ?? "";
    const req = new Request("http://localhost", {
      headers: { cookie: `agentron_vault=${value}` },
    });
    const extracted = getVaultKeyFromRequest(req);
    expect(extracted).not.toBeNull();
    expect(Buffer.isBuffer(extracted)).toBe(true);
    expect(extracted!.equals(key)).toBe(true);
  });

  it("decryptFromCookie returns null for empty or invalid value", () => {
    expect(decryptFromCookie("")).toBeNull();
    expect(decryptFromCookie("  ")).toBeNull();
    expect(decryptFromCookie("not.three.parts")).toBeNull();
  });

  it("decryptFromCookie returns null when value has three parts but invalid ciphertext", () => {
    expect(decryptFromCookie("a.b.c")).toBeNull();
  });

  it("getVaultKeyFromRequest returns null when cookie header has other cookies but not vault", () => {
    const req = new Request("http://localhost", {
      headers: { cookie: "other=value; foo=bar" },
    });
    expect(getVaultKeyFromRequest(req)).toBeNull();
  });
});
