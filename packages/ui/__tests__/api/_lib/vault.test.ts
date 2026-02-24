import { describe, it, expect, vi } from "vitest";
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
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../../../app/api/_lib/db";

describe("vault", () => {
  const salt = crypto.randomBytes(16).toString("base64url");

  it("getCookieSecret uses AGENTRON_VAULT_COOKIE_SECRET when set and length >= 32", () => {
    const prev = process.env.AGENTRON_VAULT_COOKIE_SECRET;
    const secret32 = "a".repeat(32);
    process.env.AGENTRON_VAULT_COOKIE_SECRET = secret32;
    try {
      const key = deriveVaultKey("test", salt);
      const header = buildVaultCookieHeader(key);
      const match = header.match(/agentron_vault=([^;]+)/);
      const value = decodeURIComponent(match?.[1] ?? "");
      const extracted = decryptFromCookie(value);
      expect(extracted).not.toBeNull();
      expect(extracted!.length).toBe(32);
    } finally {
      if (prev !== undefined) process.env.AGENTRON_VAULT_COOKIE_SECRET = prev;
      else delete process.env.AGENTRON_VAULT_COOKIE_SECRET;
    }
  });

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

  it("getCookieSecret uses file when env not set and file exists with valid 32-byte key", async () => {
    const prev = process.env.AGENTRON_VAULT_COOKIE_SECRET;
    delete process.env.AGENTRON_VAULT_COOKIE_SECRET;
    const dataDir = getDataDir();
    const keyPath = path.join(dataDir, "vault-cookie.secret");
    const keyContent = crypto.randomBytes(32).toString("base64");
    fs.writeFileSync(keyPath, keyContent, { mode: 0o600 });
    try {
      vi.resetModules();
      const vault2 = await import("../../../app/api/_lib/vault");
      const header = vault2.buildVaultCookieHeader(vault2.deriveVaultKey("t", salt));
      expect(header).toBeTruthy();
      expect(header).toContain(vault2.VAULT_COOKIE_NAME + "=");
    } finally {
      try {
        fs.unlinkSync(keyPath);
      } catch {
        /* ignore */
      }
      if (prev !== undefined) process.env.AGENTRON_VAULT_COOKIE_SECRET = prev;
    }
  });

  it("getCookieSecret uses fallback when file read throws (catch branch)", async () => {
    const prev = process.env.AGENTRON_VAULT_COOKIE_SECRET;
    delete process.env.AGENTRON_VAULT_COOKIE_SECRET;
    const dataDir = getDataDir();
    const keyPath = path.join(dataDir, "vault-cookie.secret");
    fs.writeFileSync(keyPath, "dummy", { mode: 0o600 });
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw new Error("read failed");
    });
    try {
      vi.resetModules();
      const vault2 = await import("../../../app/api/_lib/vault");
      const header = vault2.buildVaultCookieHeader(vault2.deriveVaultKey("t", salt));
      expect(header).toBeTruthy();
    } finally {
      readSpy.mockRestore();
      try {
        fs.unlinkSync(keyPath);
      } catch {
        /* ignore */
      }
      if (prev !== undefined) process.env.AGENTRON_VAULT_COOKIE_SECRET = prev;
    }
  });

  it("getCookieSecret ignores chmodSync error when creating new key file", async () => {
    const prev = process.env.AGENTRON_VAULT_COOKIE_SECRET;
    delete process.env.AGENTRON_VAULT_COOKIE_SECRET;
    const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementationOnce(() => {
      throw new Error("chmod failed");
    });
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValueOnce(false);
    try {
      vi.resetModules();
      const vault2 = await import("../../../app/api/_lib/vault");
      const header = vault2.buildVaultCookieHeader(vault2.deriveVaultKey("t", salt));
      expect(header).toBeTruthy();
    } finally {
      chmodSpy.mockRestore();
      existsSpy.mockRestore();
      if (prev !== undefined) process.env.AGENTRON_VAULT_COOKIE_SECRET = prev;
    }
  });
});
