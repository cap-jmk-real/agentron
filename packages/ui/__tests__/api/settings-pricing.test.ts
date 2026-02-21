import { describe, it, expect } from "vitest";
import { GET as listGet, PUT as putOne } from "../../app/api/settings/pricing/route";
import { DELETE as deleteOne } from "../../app/api/settings/pricing/[id]/route";

describe("Settings pricing API", () => {
  let createdId: string;

  it("GET /api/settings/pricing returns merged list", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("modelPattern");
    expect(data[0]).toHaveProperty("inputCostPerM");
    expect(data[0]).toHaveProperty("outputCostPerM");
  });

  it("GET /api/settings/pricing includes default model with isCustom false when no override", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const defaultEntry = data.find((m: { isCustom: boolean }) => m.isCustom === false);
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry.modelPattern).toBeDefined();
    expect(defaultEntry.id).toBeNull();
  });

  it("GET /api/settings/pricing includes custom override with isCustom true for default model", async () => {
    const listRes = await listGet();
    const list = await listRes.json();
    const firstPattern = list[0]?.modelPattern;
    if (!firstPattern) return;
    await putOne(
      new Request("http://localhost/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelPattern: firstPattern,
          inputCostPerM: 0.01,
          outputCostPerM: 0.02,
        }),
      })
    );
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const entry = data.find((m: { modelPattern: string }) => m.modelPattern === firstPattern);
    expect(entry).toBeDefined();
    expect(entry.isCustom).toBe(true);
  });

  it("GET /api/settings/pricing includes custom-only model with isCustom true", async () => {
    const pattern = "custom-only-pattern-xyz-123";
    await putOne(
      new Request("http://localhost/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelPattern: pattern,
          inputCostPerM: 0.1,
          outputCostPerM: 0.2,
        }),
      })
    );
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const entry = data.find((m: { modelPattern: string }) => m.modelPattern === pattern);
    expect(entry).toBeDefined();
    expect(entry.isCustom).toBe(true);
    expect(Number(entry.inputCostPerM)).toBe(0.1);
    expect(Number(entry.outputCostPerM)).toBe(0.2);
  });

  it("PUT /api/settings/pricing returns 400 when modelPattern missing", async () => {
    const res = await putOne(
      new Request("http://localhost/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputCostPerM: 1, outputCostPerM: 2 }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("PUT /api/settings/pricing creates custom pricing", async () => {
    const res = await putOne(
      new Request("http://localhost/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelPattern: "custom-model-v1",
          inputCostPerM: 0.5,
          outputCostPerM: 1.5,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.modelPattern).toBe("custom-model-v1");
    createdId = data.id;
  });

  it("PUT /api/settings/pricing updates existing", async () => {
    const res = await putOne(
      new Request("http://localhost/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelPattern: "custom-model-v1",
          inputCostPerM: 0.6,
          outputCostPerM: 1.8,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inputCostPerM).toBe(0.6);
  });

  it("DELETE /api/settings/pricing/:id removes entry", async () => {
    const res = await deleteOne(
      new Request("http://localhost/api/settings/pricing/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
