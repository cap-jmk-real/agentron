/**
 * Internal password vault: credentials are encrypted with a key derived from the user's
 * master password. The agent can only read credentials when the vault is unlocked (user
 * has entered the master password this session). No keychain, no file-based key fallbacks.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./db";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const VAULT_SALT = "agentron-vault-v1";
const VAULT_CHECK_PLAIN = "vault_ok";
const COOKIE_NAME = "agentron_vault";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const COOKIE_SECRET_FILE = "vault-cookie.secret";
const ENC_PREFIX = "enc:";

function getCookieSecret(): Buffer {
  const env = process.env.AGENTRON_VAULT_COOKIE_SECRET;
  if (env && env.trim().length >= 32) {
    return crypto.scryptSync(env.trim().slice(0, 64), VAULT_SALT, KEY_LENGTH);
  }
  const keyPath = path.join(getDataDir(), COOKIE_SECRET_FILE);
  try {
    if (fs.existsSync(keyPath)) {
      const raw = fs.readFileSync(keyPath, "utf8").trim();
      const key = Buffer.from(raw, "base64");
      if (key.length === KEY_LENGTH) return key;
    }
    const key = crypto.randomBytes(KEY_LENGTH);
    fs.writeFileSync(keyPath, key.toString("base64"), { mode: 0o600, encoding: "utf8" });
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      /* ignore */
    }
    return key;
  } catch {
    return crypto.scryptSync("agentron-fallback-cookie-secret", VAULT_SALT, KEY_LENGTH);
  }
}

let cookieSecret: Buffer | null = null;
function getSecret(): Buffer {
  if (!cookieSecret) cookieSecret = getCookieSecret();
  return cookieSecret;
}

/** Derive 32-byte vault key from master password and salt (scrypt). */
export function deriveVaultKey(masterPassword: string, salt: string): Buffer {
  const saltBuf = Buffer.from(salt, "base64url");
  return crypto.scryptSync(masterPassword, saltBuf, KEY_LENGTH);
}

/** Encrypt plaintext with vault key; returns "enc:iv.authTag.ciphertext" (base64url). */
export function encryptWithVaultKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** Decrypt value encrypted with encryptWithVaultKey. Returns plaintext or throws. */
export function decryptWithVaultKey(stored: string, key: Buffer): string {
  if (!stored?.startsWith(ENC_PREFIX)) return stored;
  const rest = stored.slice(ENC_PREFIX.length);
  const parts = rest.split(".");
  if (parts.length !== 3) throw new Error("Invalid vault ciphertext");
  const iv = Buffer.from(parts[0]!, "base64url");
  const authTag = Buffer.from(parts[1]!, "base64url");
  const ciphertext = Buffer.from(parts[2]!, "base64url");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

/** Encrypt vault key for cookie (so we can send it to the client as HTTP-only cookie and get it back per request). */
function encryptForCookie(vaultKey: Buffer): string {
  const secret = getSecret();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, secret, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Decrypt vault key from cookie value. Returns null if invalid. */
export function decryptFromCookie(cookieValue: string): Buffer | null {
  if (!cookieValue?.trim()) return null;
  try {
    const parts = cookieValue.trim().split(".");
    if (parts.length !== 3) return null;
    const secret = getSecret();
    const iv = Buffer.from(parts[0]!, "base64url");
    const authTag = Buffer.from(parts[1]!, "base64url");
    const ciphertext = Buffer.from(parts[2]!, "base64url");
    const decipher = crypto.createDecipheriv(ALGORITHM, secret, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return out.length === KEY_LENGTH ? out : null;
  } catch {
    return null;
  }
}

/** Parse request Cookie header and return vault key if present and valid. */
export function getVaultKeyFromRequest(request: Request): Buffer | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;)\\s*${COOKIE_NAME}=([^;]+)`));
  const value = match?.[1];
  if (!value) return null;
  return decryptFromCookie(decodeURIComponent(value));
}

/** Build Set-Cookie header value to set the vault cookie (after unlock). */
export function buildVaultCookieHeader(vaultKey: Buffer): string {
  const value = encodeURIComponent(encryptForCookie(vaultKey));
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

/** Build Set-Cookie header value to clear the vault cookie (lock). */
export function buildVaultClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const VAULT_COOKIE_NAME = COOKIE_NAME;
