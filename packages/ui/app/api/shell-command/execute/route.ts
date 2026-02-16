import { json } from "../../_lib/response";
import { logApiError } from "../../_lib/api-logger";
import { runShellCommand } from "../../_lib/shell-exec";

export const runtime = "nodejs";

/** POST: Run a shell command (user-approved). Body: { command: string }. Returns { stdout, stderr, exitCode } or { error }. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command) {
      return json({ error: "command is required" }, { status: 400 });
    }
    const { stdout, stderr, exitCode } = await runShellCommand(command);
    return json({ stdout, stderr, exitCode });
  } catch (e) {
    logApiError("/api/shell-command/execute", "POST", e);
    const message = e instanceof Error ? e.message : "Failed to execute command";
    return json({ error: message }, { status: 500 });
  }
}
