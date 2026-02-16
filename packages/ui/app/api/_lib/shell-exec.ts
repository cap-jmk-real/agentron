import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Split a compound shell command into individual commands by OS-appropriate separators.
 * - Windows (cmd.exe): &, &&, ||
 * - Unix (sh): ;, &&, ||
 * Does not split inside single- or double-quoted strings.
 */
export function splitShellCommands(command: string): string[] {
  const p = platform();
  const isWin = p === "win32";
  // Order matters: match longer separators first (&& before &)
  const separators = isWin ? ["&&", "||", "&"] : ["&&", "||", ";"];
  let remaining = command;
  const result: string[] = [];

  const pushPart = (part: string) => {
    const t = part.trim();
    if (t) result.push(t);
  };

  while (remaining.length > 0) {
    let earliest = { index: -1, len: 0, sep: "" };
    for (const sep of separators) {
      const idx = indexOfOutsideQuotes(remaining, sep);
      if (idx >= 0 && (earliest.index < 0 || idx < earliest.index)) {
        earliest = { index: idx, len: sep.length, sep };
      }
    }
    if (earliest.index < 0) {
      pushPart(remaining);
      break;
    }
    pushPart(remaining.slice(0, earliest.index));
    remaining = remaining.slice(earliest.index + earliest.len);
  }
  return result;
}

function indexOfOutsideQuotes(str: string, sub: string): number {
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  const len = sub.length;
  while (i <= str.length - len) {
    const c = str[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && str.slice(i, i + len) === sub) return i;
    i++;
  }
  return -1;
}

/** Run a shell command and return stdout/stderr. Uses PowerShell on Windows (with full PATH from registry), sh on Unix. */
export function runShellCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const isWin = platform() === "win32";
    let cmd = command;
    if (isWin) {
      // Use PowerShell; refresh PATH from registry so we see user-installed tools (podman, docker, etc.)
      // In PowerShell, "where" is an alias for Where-Object — use where.exe for finding executables
      const pathRefresh = "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')";
      const normalized = command.trimStart().replace(/^where\s+/, "where.exe ");
      cmd = `${pathRefresh}; ${normalized}`;
    }
    const [shell, args] = isWin ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd]] : ["sh", ["-c", cmd]];
    const proc = spawn(shell, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => { stdout += String(d); });
    proc.stderr?.on("data", (d) => { stderr += String(d); });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    proc.on("error", () => resolve({ stdout, stderr, exitCode: -1 }));
  });
}
