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
