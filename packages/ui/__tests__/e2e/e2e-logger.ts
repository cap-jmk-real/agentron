/**
 * E2E logger: [e2e]-prefixed stdout and optional artifact file for debugging and improving Agentron.
 */

import fs from "node:fs";
import path from "node:path";

const PREFIX = "[e2e]";
const ARTIFACTS_DIR = process.env.E2E_LOG_DIR ?? path.resolve(__dirname, "artifacts");

function shouldWriteArtifacts(): boolean {
  return process.env.E2E_SAVE_ARTIFACTS === "1";
}

let artifactStream: fs.WriteStream | null = null;

function ensureArtifactDir(): string {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
  return ARTIFACTS_DIR;
}

function openArtifactFile(testName: string): void {
  if (!shouldWriteArtifacts()) return;
  ensureArtifactDir();
  const safe = testName.replace(/[^a-z0-9-_]/gi, "_").slice(0, 80);
  const file = path.join(ARTIFACTS_DIR, `e2e-${safe}-${Date.now()}.log`);
  artifactStream = fs.createWriteStream(file, { flags: "a" });
  artifactStream.write(`# E2E artifact: ${testName}\n`);
}

function writeLine(msg: string, data?: Record<string, unknown>): void {
  const line = data ? `${PREFIX} ${msg} ${JSON.stringify(data)}` : `${PREFIX} ${msg}`;
  console.log(line);
  if (artifactStream?.writable) {
    artifactStream.write(line + "\n");
  }
}

export const e2eLog = {
  scenario(scenarioId: string, inputSummary?: string): void {
    writeLine("scenario", { scenarioId, inputSummary });
  },

  step(step: string, data?: Record<string, unknown>): void {
    writeLine("step", { step, ...data });
  },

  runId(runId: string): void {
    writeLine("runId", { runId });
  },

  toolCall(toolName: string, resultPreview?: string): void {
    writeLine("toolCall", {
      toolName,
      resultPreview: resultPreview?.slice(0, 200),
    });
  },

  outcome(status: string, durationMs?: number, error?: string): void {
    writeLine("outcome", { status, durationMs, error });
  },

  startTest(testName: string): void {
    if (shouldWriteArtifacts()) {
      openArtifactFile(testName);
    }
  },

  endTest(): void {
    if (artifactStream) {
      artifactStream.end();
      artifactStream = null;
    }
  },

  writeRunArtifact(runId: string, output: unknown, trail: unknown): void {
    if (!shouldWriteArtifacts() || !artifactStream?.writable) return;
    artifactStream.write(`\n# Run output (runId=${runId})\n`);
    artifactStream.write(JSON.stringify(output, null, 2).slice(0, 50_000));
    artifactStream.write("\n\n# Trail\n");
    artifactStream.write(JSON.stringify(trail, null, 2).slice(0, 30_000));
    artifactStream.write("\n");
  },
};
