import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Per-worker isolation: each Vitest worker gets its own DB and data dir so tests can run in parallel.
// Must be set before any module that imports db is loaded.
const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? process.pid;
const baseDir = path.join(
  os.tmpdir(),
  `agentron-test-${workerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
);
fs.mkdirSync(baseDir, { recursive: true });
process.env.AGENTRON_DATA_DIR = baseDir;
process.env.AGENTRON_DB_PATH = path.join(baseDir, "agentron.sqlite");

// Per-worker port range for sandbox bindings so parallel e2e workers do not allocate the same host port.
const workerNum = parseInt(String(workerId), 10) || 0;
const rangeSize = 100;
process.env.SANDBOX_PORT_START = String(18100 + workerNum * rangeSize);
process.env.SANDBOX_PORT_END = String(18100 + (workerNum + 1) * rangeSize);
