import { spawn } from "node:child_process";

export const REMOTE_CONNECTION_GUIDANCE = `
If the connection failed, try:

**On the server:**
- Ensure SSH is running: \`sudo systemctl status sshd\` (Linux) or \`sudo systemctl status ssh\`.
- Allow the user to log in: add your public key to \`~/.ssh/authorized_keys\` (for key auth), or ensure password auth is enabled in \`/etc/ssh/sshd_config\` (PasswordAuthentication yes) and restart sshd.
- Open port 22 (or your SSH port) in the local firewall: \`sudo ufw allow 22\` (if using ufw).

**On the cloud provider:**
- In the instance security group / firewall rules, allow inbound TCP on port 22 (SSH) from your IP or 0.0.0.0/0 (less secure).
- Ensure the VM has a public IP and that you're using that IP (or a DNS name pointing to it).

**From your machine:**
- Test manually: \`ssh -i <keyPath> user@host -p port\` (or without -i for password). If that works, save the server in the chat and use it for new agents.
`.trim();

export type TestRemoteResult = { ok: boolean; message: string; guidance?: string };

export async function testRemoteConnection(params: {
  host: string;
  port?: number;
  user: string;
  authType: string;
  keyPath?: string;
}): Promise<TestRemoteResult> {
  const port = Number(params.port) || 22;
  if (params.authType === "password") {
    return {
      ok: false,
      message: "Automated test with password is not supported for security. Ask the user to test manually: `ssh " + params.user + "@" + params.host + " -p " + port + "`. If it works, they can ask you to save the server (you will not store the password).",
      guidance: REMOTE_CONNECTION_GUIDANCE,
    };
  }
  if (!params.keyPath) {
    return {
      ok: false,
      message: "To test from here the user must provide a key path (keyPath). Otherwise ask them to test manually with `ssh " + params.user + "@" + params.host + " -p " + port + "` and then ask if they want to save the server.",
      guidance: REMOTE_CONNECTION_GUIDANCE,
    };
  }
  const args = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", params.keyPath,
    "-p", String(port),
    `${params.user}@${params.host}`,
    "exit",
  ];
  const result = await new Promise<TestRemoteResult>((resolve) => {
    const proc = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let done = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, message: "Connection timed out after 15s.", guidance: REMOTE_CONNECTION_GUIDANCE });
    }, 15000);
    const finish = (r: TestRemoteResult) => {
      if (!done) {
        done = true;
        if (timeoutId != null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve(r);
      }
    };
    proc.stderr?.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      if (code === 0) finish({ ok: true, message: "SSH connection succeeded." });
      else finish({ ok: false, message: "SSH connection failed. " + (stderr || `Exit code ${code}`).trim(), guidance: REMOTE_CONNECTION_GUIDANCE });
    });
    proc.on("error", (err) => finish({ ok: false, message: "Failed to run ssh: " + err.message, guidance: REMOTE_CONNECTION_GUIDANCE }));
  });
  return result;
}
