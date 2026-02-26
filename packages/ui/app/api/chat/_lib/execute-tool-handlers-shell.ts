/**
 * Tool handlers for allowlisted shell commands: run_shell_command.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { getShellCommandAllowlist } from "../../_lib/app-settings";
import { runShellCommand } from "../../_lib/shell-exec";

export const SHELL_TOOL_NAMES = ["run_shell_command"] as const;

export async function handleShellTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  if (name !== "run_shell_command") return undefined;
  const command = typeof a.command === "string" ? (a.command as string).trim() : "";
  if (!command) return { error: "command is required", needsApproval: false };
  const allowlist = getShellCommandAllowlist();
  const isAllowed = allowlist.some((entry) => entry === command);
  if (!isAllowed) {
    return {
      needsApproval: true,
      command,
      message:
        "Command requires user approval. The user can approve it in the chat UI or add it to the allowlist in Settings.",
    };
  }
  try {
    const { stdout, stderr, exitCode } = await runShellCommand(command);
    return {
      command,
      stdout,
      stderr,
      exitCode,
      message: stderr ? `stdout:\n${stdout}\nstderr:\n${stderr}` : stdout || "(no output)",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "Shell command failed", message, exitCode: -1 };
  }
}
