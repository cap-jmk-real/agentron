import { describe, it, expect } from "vitest";
import { json } from "../../../app/api/_lib/response";

describe("response.json", () => {
  it("returns Response with JSON body and Content-Type when init omitted", async () => {
    const res = json({ a: 1 });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("merges init without headers", async () => {
    const res = json({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("merges init.headers with Content-Type", async () => {
    const res = json(null, { headers: { "X-Custom": "y" } });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("X-Custom")).toBe("y");
  });
});
