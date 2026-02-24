import { describe, it, expect } from "vitest";
import { store, json, getGlobalStore } from "../../../app/api/_lib/store";

describe("store", () => {
  it("getGlobalStore returns same instance on subsequent calls", () => {
    const a = getGlobalStore();
    const b = getGlobalStore();
    expect(a).toBe(b);
    expect(a.agents).toBe(b.agents);
  });

  it("exposes agents, workflows, llmProviders, tools, runs as Maps", () => {
    expect(store.agents).toBeInstanceOf(Map);
    expect(store.workflows).toBeInstanceOf(Map);
    expect(store.llmProviders).toBeInstanceOf(Map);
    expect(store.tools).toBeInstanceOf(Map);
    expect(store.runs).toBeInstanceOf(Map);
  });

  it("json() returns Response with JSON body and Content-Type application/json", async () => {
    const res = json({ foo: "bar" });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const data = await res.json();
    expect(data).toEqual({ foo: "bar" });
  });

  it("json() merges status in init", () => {
    const res = json({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
  });

  it("json() merges custom headers with Content-Type", () => {
    const res = json(null, { headers: { "X-Custom": "y" } });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("X-Custom")).toBe("y");
  });
});
