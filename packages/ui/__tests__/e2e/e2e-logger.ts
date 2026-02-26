/**
 * E2E logger: [e2e]-prefixed stdout and optional artifact file for debugging and improving Agentron.
 */

import fs from "node:fs";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { db, chatMessages, executions } from "../../app/api/_lib/db";
import { fromChatMessageRow } from "../../app/api/_lib/db-mappers";

const PREFIX = "[e2e]";
const PROGRESS_POLL_MS = 1500;
const OUTPUT_PREVIEW_LEN = 250;
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

  writeRunArtifact(
    runId: string,
    output: unknown,
    trail: unknown,
    executionLog?: Array<{ phase: string; label: string | null; payload: string | null }> | null
  ): void {
    if (!shouldWriteArtifacts() || !artifactStream?.writable) return;
    artifactStream.write(`\n# Run output (runId=${runId})\n`);
    artifactStream.write(JSON.stringify(output, null, 2).slice(0, 50_000));
    artifactStream.write("\n\n# Trail\n");
    artifactStream.write(JSON.stringify(trail, null, 2).slice(0, 30_000));
    if (executionLog && executionLog.length > 0) {
      const attacksAndCommands = formatAttacksAndCommands(executionLog);
      artifactStream.write(
        "\n\n# Attacks and defender commands (exact HTTP requests and shell commands)\n"
      );
      artifactStream.write(attacksAndCommands);
      artifactStream.write(
        "\n\n# Execution log (LLM requests/responses and tool calls during run)\n"
      );
      artifactStream.write(JSON.stringify(executionLog, null, 2).slice(0, 100_000));
      writeExecutionLogFile(runId, executionLog);
    }
    artifactStream.write("\n");
  },
};

export type ExecutionLogEntryForFormat = {
  phase: string;
  label: string | null;
  payload: string | null;
};

/**
 * Format execution log into a readable list of exact HTTP requests (attacker) and shell commands (defender).
 * Exported for unit tests.
 */
export function formatAttacksAndCommands(log: Array<ExecutionLogEntryForFormat>): string {
  const lines: string[] = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.phase === "tool_call" && e.label) {
      const payloadObj = parsePayload(e.payload);
      const formatted = formatToolCallEntry(e.label, payloadObj);
      if (formatted) lines.push(formatted);
    } else if (e.phase === "tool_result" && e.label) {
      const payloadObj = parsePayload(e.payload);
      const summary = formatToolResultSummary(payloadObj);
      if (summary) lines.push("  " + summary);
    }
  }
  return lines.length ? lines.join("\n") : "(no tool calls)";
}

function parsePayload(payload: string | null): Record<string, unknown> | null {
  if (payload == null) return null;
  try {
    const p = JSON.parse(payload) as unknown;
    return typeof p === "string"
      ? (JSON.parse(p) as Record<string, unknown>)
      : (p as Record<string, unknown>);
  } catch {
    return null;
  }
}

function formatToolCallEntry(label: string, payload: Record<string, unknown> | null): string {
  if (!payload || typeof payload.input !== "object" || payload.input == null) return "";
  const input = payload.input as Record<string, unknown>;

  switch (label) {
    case "std-fetch-url": {
      const method = String(input.method ?? "GET");
      const url = String(input.url ?? "");
      const headers = input.headers as Record<string, string> | undefined;
      const body = input.body as string | undefined;
      let out = `${method} ${url}`;
      if (headers && Object.keys(headers).length > 0)
        out += `\n  Headers: ${JSON.stringify(headers)}`;
      if (body) out += `\n  Body: ${body.slice(0, 200)}`;
      return `[std-fetch-url] ${out}`;
    }
    case "std-http-request": {
      const method = String(input.method ?? "GET");
      const url = String(input.url ?? "");
      const headers = input.headers as Record<string, string> | undefined;
      const body = input.body as string | undefined;
      let out = `${method} ${url}`;
      if (headers && Object.keys(headers).length > 0)
        out += `\n  Headers: ${JSON.stringify(headers)}`;
      if (body) out += `\n  Body: ${body.slice(0, 500)}`;
      return `[std-http-request] ${out}`;
    }
    case "std-execute-code": {
      const command = String(input.command ?? "");
      const sandboxId = input.sandboxId as string | undefined;
      const sid = sandboxId ? ` (sandbox ${sandboxId.slice(0, 8)}…)` : "";
      return `[std-execute-code]${sid} ${command}`;
    }
    case "std-list-sandboxes":
      return "[std-list-sandboxes]";
    default:
      return `[${label}] ${JSON.stringify(input).slice(0, 300)}`;
  }
}

function formatToolResultSummary(payload: Record<string, unknown> | null): string {
  if (!payload) return "→ —";
  if ("error" in payload && payload.error != null) return `→ error: ${String(payload.error)}`;
  const result = payload.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== "object") return "→ ok";
  if ("status" in result && typeof result.status === "number") return `→ status ${result.status}`;
  if ("exitCode" in result && typeof result.exitCode === "number")
    return `→ exit ${result.exitCode}`;
  if ("error" in result) return `→ error: ${String(result.error)}`;
  return "→ ok";
}

/** Write execution log to a dedicated file (attacks, commands, LLM I/O) so you have one "my log" file per run. */
function writeExecutionLogFile(
  runId: string,
  executionLog: Array<{ phase: string; label: string | null; payload: string | null }>
): void {
  if (!shouldWriteArtifacts()) return;
  const dir = ensureArtifactDir();
  const file = path.join(dir, `e2e-execution-${runId}.log`);
  const header = `# Execution log (runId=${runId})\n# Tool calls and results = attacks sent, commands executed, LLM request/response.\n\n`;
  const body = JSON.stringify(executionLog, null, 2);
  fs.writeFileSync(file, header + body, "utf8");
  console.log(`${PREFIX} execution log file: ${path.resolve(file)}`);
}

/**
 * Fetch assistant messages (content, toolCalls, llmTrace) for a conversation.
 * Use when e2e design was done via chat: e2eLog.step("design_phase_llm", { conversationId, messages: await getDesignPhaseLlmMessages(conversationId) }).
 */
export async function getDesignPhaseLlmMessages(
  conversationId: string
): Promise<Array<{ content: string; toolCalls?: unknown; llmTrace?: unknown }>> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
  const assistant = rows.filter((r) => r.role === "assistant").map((r) => fromChatMessageRow(r));
  return assistant.map((m) => ({
    content: m.content,
    ...(m.toolCalls != null && { toolCalls: m.toolCalls }),
    ...(m.llmTrace != null && { llmTrace: m.llmTrace }),
  }));
}

function shouldLogProgress(): boolean {
  return process.env.E2E_LOG_PROGRESS === "1" || process.env.E2E_SAVE_ARTIFACTS === "1";
}

/**
 * Start a background poll that logs workflow progress from the DB (trail length, message, last step).
 * Writes to stdout and to a progress log file in ARTIFACTS_DIR for easier reading.
 * Call the returned function to stop. No-op if E2E_LOG_PROGRESS or E2E_SAVE_ARTIFACTS is not set.
 */
export function startWorkflowProgressLogger(workflowId: string): () => void {
  if (!shouldLogProgress()) return () => {};
  let lastTrailLength = -1;
  let lastMessage: string | undefined;
  ensureArtifactDir();
  const progressLogPath = path.join(
    ARTIFACTS_DIR,
    `e2e-progress-${workflowId.slice(0, 8)}-${Date.now()}.log`
  );
  const progressLogStream = fs.createWriteStream(progressLogPath, { flags: "a" });
  progressLogStream.write(`# E2E workflow progress (workflowId=${workflowId})\n`);
  console.log(`${PREFIX} progress log file: ${progressLogPath}`);
  const intervalId = setInterval(async () => {
    try {
      const rows = await db
        .select({ output: executions.output })
        .from(executions)
        .where(
          and(
            eq(executions.targetType, "workflow"),
            eq(executions.targetId, workflowId),
            eq(executions.status, "running")
          )
        );
      if (rows.length === 0) return;
      const raw = rows[0]?.output;
      let parsed: { trail?: unknown[]; message?: string } = {};
      if (raw != null) {
        try {
          parsed =
            typeof raw === "string" ? (JSON.parse(raw) as typeof parsed) : (raw as typeof parsed);
        } catch {
          return;
        }
      }
      const trail = Array.isArray(parsed.trail) ? parsed.trail : [];
      const message = typeof parsed.message === "string" ? parsed.message : "";
      if (trail.length === lastTrailLength && message === lastMessage) return;
      lastTrailLength = trail.length;
      lastMessage = message;
      const lastStep =
        trail.length > 0 ? (trail[trail.length - 1] as Record<string, unknown>) : undefined;
      const outputPreview =
        lastStep?.output != null ? String(lastStep.output).slice(0, OUTPUT_PREVIEW_LEN) : undefined;
      const line: Record<string, unknown> = {
        trailLength: trail.length,
        message: message || undefined,
        lastNodeId: lastStep?.nodeId,
        lastAgentName: lastStep?.agentName,
        round: lastStep?.round,
      };
      if (outputPreview !== undefined) line.outputPreview = outputPreview;
      const lineStr = `${PREFIX} progress ${JSON.stringify(line)}`;
      console.log(lineStr);
      if (progressLogStream.writable) progressLogStream.write(lineStr + "\n");
      if (artifactStream?.writable) {
        artifactStream.write(lineStr + "\n");
      }
    } catch {
      // ignore poll errors
    }
  }, PROGRESS_POLL_MS);
  return () => {
    clearInterval(intervalId);
    progressLogStream.end();
  };
}
