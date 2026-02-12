import { describe, it, expect } from "vitest";
import { GET as statusGet } from "../../app/api/ollama/status/route";
import { GET as systemGet } from "../../app/api/ollama/system/route";

describe("Ollama API", () => {
  it("GET /api/ollama/status returns running and version or error", async () => {
    const res = await statusGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("running");
    expect(typeof data.running).toBe("boolean");
    if (data.running) {
      expect(data.version).toBeDefined();
    } else {
      expect(data.error).toBeDefined();
    }
  });

  it("GET /api/ollama/system returns system resources", async () => {
    const res = await systemGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
  });
});
