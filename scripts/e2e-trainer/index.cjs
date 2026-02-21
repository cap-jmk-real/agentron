/**
 * Minimal stub trainer for e2e: implements local trainer contract (POST /train, GET /status/:runId).
 * Completes immediately and returns a synthetic output_model_ref so e2e can validate
 * the full pipeline (trigger_training → poll → register_trained_model → list_specialist_models).
 *
 * Run: node scripts/e2e-trainer/index.cjs
 * Port: 8765 (or E2E_TRAINER_PORT). Set LOCAL_TRAINER_URL when running the app (e.g. http://localhost:8765).
 */
const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.E2E_TRAINER_PORT) || 8765;

const runs = new Map();

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function writePlaceholderArtifact(runId) {
  const dir = process.env.AGENTRON_DATA_DIR || path.join(process.cwd(), ".data");
  const modelsDir = path.join(dir, "models");
  try {
    fs.mkdirSync(modelsDir, { recursive: true });
  } catch {
    // ignore
  }
  const outPath = path.join(modelsDir, `e2e-finetuned-${runId}`);
  fs.writeFileSync(outPath, `e2e-stub-run:${runId}\n`, "utf8");
  return outPath;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "";
  const method = req.method || "GET";

  try {
    if (method === "GET" && (url === "/health" || url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === "POST" && url === "/train") {
      const body = await parseBody(req);
      const runId = body.runId || body.run_id;
      if (!runId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "runId required" }));
        return;
      }
      const outputPath = writePlaceholderArtifact(runId);
      runs.set(runId, { status: "completed", output_model_ref: outputPath });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ run_id: runId }));
      return;
    }

    const statusMatch = url.match(/^\/status\/([^/]+)$/);
    if (method === "GET" && statusMatch) {
      const runId = statusMatch[1];
      const state = runs.get(runId);
      if (!state) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "pending", error: "run not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: state.status,
          output_model_ref: state.output_model_ref ?? null,
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e-trainer] listening on http://127.0.0.1:${PORT}`);
});
