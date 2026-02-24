import { describe, it, expect } from "vitest";
import { signChallenge } from "../../../app/api/_lib/openclaw-device-identity";

describe("openclaw-device-identity", () => {
  it("signChallenge returns device payload with id, publicKey, signature, signedAt, nonce", () => {
    const payload = signChallenge({ nonce: "test-nonce-1" });
    expect(payload).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      publicKey: expect.any(String),
      signature: expect.any(String),
      signedAt: expect.any(Number),
      nonce: "test-nonce-1",
    });
    expect(payload.publicKey.length).toBeGreaterThan(0);
    expect(payload.signature.length).toBeGreaterThan(0);
  });

  it("signChallenge reuses same keypair (stable id and publicKey across calls)", () => {
    const a = signChallenge({ nonce: "same" });
    const b = signChallenge({ nonce: "same" });
    expect(a.id).toBe(b.id);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.signature).toBeTruthy();
    expect(b.signature).toBeTruthy();
  });

  it("signChallenge with different nonce yields different signature", () => {
    const a = signChallenge({ nonce: "n1" });
    const b = signChallenge({ nonce: "n2" });
    expect(a.signature).not.toBe(b.signature);
    expect(a.id).toBe(b.id);
  });
});
