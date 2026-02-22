import { describe, it, expect } from "vitest";
import { POST } from "../../app/api/run-code/route";

describe("Run code API", () => {
  it("POST /api/run-code returns 400 when body is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON");
  });

  it("POST /api/run-code returns 400 when code is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("code is required");
  });

  it("POST /api/run-code returns 400 when code is empty string", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("code is required");
  });

  it("POST /api/run-code returns 400 when code is whitespace only", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "   \n\t  " }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("code is required");
  });
});
