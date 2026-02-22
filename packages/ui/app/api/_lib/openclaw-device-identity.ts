/**
 * OpenClaw gateway device identity: Ed25519 keypair and challenge signing.
 * Protocol: gateway sends connect.challenge { nonce, ts }; client must send device { id, publicKey, signature, signedAt, nonce }.
 * Device id and publicKey format must match OpenClaw infra/device-identity.ts (deriveDeviceIdFromPublicKey, normalizeDevicePublicKeyBase64Url).
 * Signature is over buildDeviceAuthPayload("v2", deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce).
 */

import * as crypto from "node:crypto";

const ALGORITHM = "ed25519";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type ChallengePayload = { nonce: string; ts?: number };

export type DeviceIdentityPayload = {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
};

export type SignChallengeOptions = {
  clientId?: string;
  clientMode?: string;
  role?: string;
  scopes?: string[];
  token?: string;
};

type KeyPair = { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };

let cachedKeyPair: KeyPair | null = null;

function getOrCreateKeyPair(): KeyPair {
  if (cachedKeyPair) return cachedKeyPair;
  const { publicKey, privateKey } = crypto.generateKeyPairSync(ALGORITHM);
  cachedKeyPair = { publicKey, privateKey };
  return cachedKeyPair;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

/** Extract raw 32-byte Ed25519 public key from SPKI DER (matches OpenClaw derivePublicKeyRaw). */
function rawPublicKeyFromSpki(spki: Buffer): Buffer {
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

/** Device id: SHA256(raw 32-byte public key).hex (matches OpenClaw deriveDeviceIdFromPublicKey). */
function deviceIdFromPublicKey(publicKey: crypto.KeyObject): string {
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const raw = rawPublicKeyFromSpki(spki);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Public key for connect.params.device: base64url of raw 32 bytes (matches OpenClaw normalizeDevicePublicKeyBase64Url). */
function publicKeyBase64Url(publicKey: crypto.KeyObject): string {
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return base64UrlEncode(rawPublicKeyFromSpki(spki));
}

/** Build payload string that gateway expects to be signed (matches OpenClaw buildDeviceAuthPayload). */
function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
}): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
  ].join("|");
}

/** Sign the challenge; returns device payload for connect.params.device. */
export function signChallenge(
  payload: ChallengePayload,
  options: SignChallengeOptions = {}
): DeviceIdentityPayload {
  const pair = getOrCreateKeyPair();
  const nonce = String(payload.nonce ?? "");
  const signedAt = Date.now();
  const deviceId = deviceIdFromPublicKey(pair.publicKey);
  const authPayload = buildDeviceAuthPayload({
    deviceId,
    clientId: options.clientId ?? "gateway-client",
    clientMode: options.clientMode ?? "backend",
    role: options.role ?? "operator",
    scopes: options.scopes ?? ["operator.admin", "operator.read", "operator.write"],
    signedAtMs: signedAt,
    token: options.token ?? "",
    nonce,
  });
  const signature = crypto.sign(null, Buffer.from(authPayload, "utf8"), pair.privateKey);
  return {
    id: deviceId,
    publicKey: publicKeyBase64Url(pair.publicKey),
    signature: base64UrlEncode(signature),
    signedAt,
    nonce,
  };
}
