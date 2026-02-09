import path from "node:path";
import os from "node:os";

// Use a temp DB for tests so we don't touch the real .data/agentron.sqlite.
// Must be set before any module that imports db is loaded.
process.env.AGENTRON_DB_PATH = path.join(os.tmpdir(), `agentron-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
