const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("runtime files exist", async () => {
  const registryPath = path.join(__dirname, "../packages/runtime/src/tools/registry.ts");
  assert.equal(fs.existsSync(registryPath), true);
});

test(
  "rate-limit queue API returns pending and recentDelayed arrays",
  { skip: process.env.SKIP_HTTP_TESTS === "1" },
  async () => {
    const base = process.env.UI_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${base}/api/rate-limit/queue`);
    assert.equal(res.ok, true, `expected 2xx, got ${res.status}`);
    const data = await res.json();
    assert.equal(Array.isArray(data.pending), true, "pending must be an array");
    assert.equal(Array.isArray(data.recentDelayed), true, "recentDelayed must be an array");
  }
);
