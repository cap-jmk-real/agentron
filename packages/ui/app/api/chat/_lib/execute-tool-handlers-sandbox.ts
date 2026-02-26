/**
 * Tool handlers for sandbox/container tools: create_sandbox, execute_code, run_container_command, list_sandboxes, get_sandbox.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import {
  db,
  sandboxes,
  sandboxSiteBindings,
  fromSandboxRow,
  toSandboxRow,
  toSandboxSiteBindingRow,
} from "../../_lib/db";
import { getContainerManager, withContainerInstallHint } from "../../_lib/container-manager";
import { allocateHostPort } from "../../_lib/sandbox-site-bindings";
import { eq } from "drizzle-orm";

const EXIT_DIAGNOSTICS_LOG_TAIL = 50;
const EXIT_HINT =
  "Container exited. Recreate the sandbox with create_sandbox or start the container if your engine supports it.";

type ContainerManager = ReturnType<typeof getContainerManager>;

async function getExitDiagnostics(
  podman: ContainerManager,
  containerId: string
): Promise<{ state: string; exitCode: number; oomKilled: boolean; logs: string; hint: string }> {
  const [state, exitInfo, logs] = await Promise.all([
    podman.getContainerState(containerId),
    podman.getContainerExitInfo(containerId),
    podman.logs(containerId, EXIT_DIAGNOSTICS_LOG_TAIL).catch(() => ""),
  ]);
  let hint = EXIT_HINT;
  if (exitInfo.oomKilled) {
    hint += " The container may have been killed due to out of memory.";
  }
  return {
    state,
    exitCode: exitInfo.exitCode,
    oomKilled: exitInfo.oomKilled,
    logs,
    hint,
  };
}

export const SANDBOX_TOOL_NAMES = [
  "create_sandbox",
  "execute_code",
  "run_container_command",
  "list_sandboxes",
  "get_sandbox",
] as const;

export async function handleSandboxTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "create_sandbox": {
      const id = crypto.randomUUID();
      const sandboxName = (a.name as string) || `sandbox-${id.slice(0, 8)}`;
      const containerName = `sandbox-${Date.now()}-${id.slice(0, 8)}`;
      const image = a.image as string;
      const envArg =
        a.env && typeof a.env === "object" && !Array.isArray(a.env)
          ? (a.env as Record<string, string>)
          : undefined;
      const useImageCmdArg = a.useImageCmd === true;
      const cmdArg =
        Array.isArray(a.cmd) && a.cmd.length > 0
          ? (a.cmd as string[]).filter((x): x is string => typeof x === "string")
          : undefined;
      const containerPortArg =
        typeof (a as { containerPort?: number | string }).containerPort === "number"
          ? (a as { containerPort: number }).containerPort
          : parseInt(String((a as { containerPort?: number | string }).containerPort ?? ""), 10);
      const wantPort =
        Number.isInteger(containerPortArg) && containerPortArg >= 1 && containerPortArg <= 65535;
      const hostNorm =
        (typeof (a as { host?: string }).host === "string" &&
          (a as { host: string }).host.trim()) ||
        "127.0.0.1";
      let allocatedHostPort: number | undefined;
      if (wantPort) {
        try {
          allocatedHostPort = await allocateHostPort();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      }
      const config: { useImageCmd?: boolean; env?: Record<string, string>; cmd?: string[] } =
        typeof image === "string" && image.toLowerCase().includes("openclaw")
          ? (() => {
              const patchScript = [
                'const fs=require("fs");',
                'const paths=["/root/.openclaw/openclaw.json","/home/node/.openclaw/openclaw.json"];',
                'const strip=(s)=>s.replace(/\\/\\/[^\\n]*/g,"").replace(/\\/\\*[\\s\\S]*?\\*\\//g,"");',
                "let ok=false;",
                'for(const p of paths){try{const c=JSON.parse(strip(fs.readFileSync(p,"utf8")));c.gateway=c.gateway||{};c.gateway.port=18788;c.gateway.bind="loopback";c.gateway.controlUi=c.gateway.controlUi||{};c.gateway.controlUi.dangerouslyDisableDeviceAuth=true;c.gateway.controlUi.allowInsecureAuth=true;fs.writeFileSync(p,JSON.stringify(c,null,2));ok=true;}catch(e){}}',
                "if(!ok)process.exit(1);",
              ].join("");
              const ollamaPatchScript = [
                'const fs=require("fs");',
                'const paths=["/root/.openclaw/openclaw.json","/home/node/.openclaw/openclaw.json"];',
                'const strip=(s)=>s.replace(/\\/\\/[^\\n]*/g,"").replace(/\\/\\*[\\s\\S]*?\\*\\//g,"");',
                "const model=process.env.OPENCLAW_AGENT_MODEL;",
                'const baseUrl=process.env.OPENCLAW_OLLAMA_BASE_URL||"http://host.containers.internal:11434/v1";',
                "let ok=false;",
                "if(!model){process.exit(0);}",
                'for(const p of paths){try{const c=JSON.parse(strip(fs.readFileSync(p,"utf8")));c.models=c.models||{};c.models.providers=c.models.providers||{};c.models.providers.ollama={baseUrl,apiKey:"ollama-local",api:"openai-responses",models:[]};c.agents=c.agents||{};c.agents.defaults=c.agents.defaults||{};c.agents.defaults.model=c.agents.defaults.model||{};if(typeof c.agents.defaults.model==="string")c.agents.defaults.model={primary:c.agents.defaults.model};c.agents.defaults.model.primary=model;fs.writeFileSync(p,JSON.stringify(c,null,2));ok=true;}catch(e){}}',
                "if(!ok)process.exit(1);",
              ].join("");
              const proxyScript =
                'var n=require("net");var s=n.createServer(function(sock){var c=n.createConnection(18788,"127.0.0.1",function(){sock.pipe(c);c.pipe(sock)});c.on("error",function(){sock.destroy()});sock.on("error",function(){c.destroy()})});s.on("error",function(e){console.error("proxy error",e.message||e)});s.listen(18789,"0.0.0.0",function(){if(this.listening)process.stderr.write("proxy listening\\n")});setInterval(function(){},86400000)';
              const patchB64 = Buffer.from(patchScript, "utf8").toString("base64");
              const ollamaPatchB64 = Buffer.from(ollamaPatchScript, "utf8").toString("base64");
              const proxyB64 = Buffer.from(proxyScript, "utf8").toString("base64");
              const useOllama =
                (envArg && (envArg.OPENCLAW_AGENT_MODEL || envArg.OPENCLAW_OLLAMA_BASE_URL)) ||
                false;
              const startupScript = [
                '[ -n "$OPENCLAW_E2E_TOKEN" ] && node openclaw.mjs config set gateway.auth.token "$OPENCLAW_E2E_TOKEN" ; true',
                "node openclaw.mjs onboard --non-interactive --accept-risk --flow quickstart --mode local --skip-channels --skip-skills --skip-daemon --skip-ui --skip-health",
                '[ -n "$OPENCLAW_E2E_TOKEN" ] && node openclaw.mjs config set gateway.auth.token "$OPENCLAW_E2E_TOKEN" ; true',
                'echo "$OC_PATCH_B64" | base64 -d | node',
                'echo "$OC_OLLAMA_PATCH_B64" | base64 -d | node',
                '(mkdir -p /tmp/oc-client && echo \'{"name":"oc-client","dependencies":{"ws":"^8.18.0"}}\' > /tmp/oc-client/package.json && cd /tmp/oc-client && npm install --omit=dev 2>/dev/null) &',
                "( node openclaw.mjs gateway --allow-unconfigured & )",
                '( echo "$OC_PROXY_B64" | base64 -d | node & )',
                "sleep 12",
              ].join("\n");
              const startupB64 = Buffer.from(startupScript, "utf8").toString("base64");
              const cmdStr = 'echo "$OC_STARTUP_B64" | base64 -d | sh ; exec sleep infinity';
              const networkArg =
                typeof (a as { network?: string }).network === "string"
                  ? (a as { network: string }).network
                  : undefined;
              const baseConfig: {
                useImageCmd: true;
                network?: boolean | string;
                env?: Record<string, string>;
                cmd: string[];
              } = {
                useImageCmd: true,
                cmd: ["-c", cmdStr],
                env: {
                  ...envArg,
                  OC_STARTUP_B64: startupB64,
                  OC_PATCH_B64: patchB64,
                  OC_OLLAMA_PATCH_B64: ollamaPatchB64,
                  OC_PROXY_B64: proxyB64,
                },
              };
              if (useOllama || networkArg)
                baseConfig.network = networkArg ?? (useOllama ? true : undefined);
              return baseConfig;
            })()
          : useImageCmdArg
            ? {
                useImageCmd: true,
                ...(cmdArg?.length ? { cmd: cmdArg } : {}),
                ...(envArg ? { env: envArg } : {}),
                ...(typeof (a as { network?: string }).network === "string"
                  ? { network: (a as { network: string }).network }
                  : {}),
              }
            : {
                ...(envArg ? { env: envArg } : {}),
                ...(typeof (a as { network?: string }).network === "string"
                  ? { network: (a as { network: string }).network }
                  : {}),
              };
      const finalConfig =
        allocatedHostPort !== undefined
          ? {
              ...config,
              network: (config as { network?: boolean | string }).network ?? true,
              ports: { [allocatedHostPort]: containerPortArg },
            }
          : config;
      let containerId: string | undefined;
      let status: "creating" | "running" | "stopped" = "creating";
      const podman = getContainerManager();
      try {
        containerId = await podman.create(image, containerName, finalConfig);
        status = "running";
      } catch (err) {
        status = "stopped";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = withContainerInstallHint(msg);
        if (allocatedHostPort !== undefined) {
          return {
            error: hint !== msg ? hint : `Container failed to start: ${msg}. Port was not bound.`,
          };
        }
        if (hint !== msg) {
          return { id, name: sandboxName, status: "stopped", message: hint };
        }
      }
      let immediateExitDiagnostics: Awaited<ReturnType<typeof getExitDiagnostics>> | undefined;
      if (containerId && status === "running") {
        const state = await podman.getContainerState(containerId);
        if (state !== "running") {
          status = "stopped";
          immediateExitDiagnostics = await getExitDiagnostics(podman, containerId);
        }
      }
      await db
        .insert(sandboxes)
        .values(
          toSandboxRow({
            id,
            name: sandboxName,
            image,
            status,
            containerId,
            config: finalConfig,
            createdAt: Date.now(),
          })
        )
        .run();
      if (allocatedHostPort !== undefined && containerId !== undefined) {
        await db
          .insert(sandboxSiteBindings)
          .values(
            toSandboxSiteBindingRow({
              id: crypto.randomUUID(),
              sandboxId: id,
              host: hostNorm.toLowerCase().trim(),
              containerPort: containerPortArg,
              hostPort: allocatedHostPort,
              createdAt: Date.now(),
            })
          )
          .run();
      }
      return {
        id,
        name: sandboxName,
        status,
        ...(containerId ? { containerId } : {}),
        ...(allocatedHostPort !== undefined && containerId !== undefined
          ? { hostPort: allocatedHostPort }
          : {}),
        message:
          status === "running"
            ? `Sandbox "${sandboxName}" running`
            : immediateExitDiagnostics
              ? immediateExitDiagnostics.hint
              : "Sandbox created but failed to start",
        ...(immediateExitDiagnostics
          ? {
              state: immediateExitDiagnostics.state,
              exitCode: immediateExitDiagnostics.exitCode,
              oomKilled: immediateExitDiagnostics.oomKilled,
              logs: immediateExitDiagnostics.logs,
            }
          : {}),
      };
    }
    case "execute_code": {
      const sbId = a.sandboxId as string;
      const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sbId));
      if (rows.length === 0) return { error: "Sandbox not found" };
      const sb = fromSandboxRow(rows[0]);
      if (!sb.containerId) return { error: "Sandbox has no container" };
      const podman = getContainerManager();
      const state = await podman.getContainerState(sb.containerId);
      if (state !== "running") {
        const diagnostics = await getExitDiagnostics(podman, sb.containerId);
        return {
          stdout: "",
          stderr: `Sandbox container has exited (state: ${diagnostics.state}, exitCode: ${diagnostics.exitCode}). ${diagnostics.hint}`,
          exitCode: diagnostics.exitCode,
          state: diagnostics.state,
          oomKilled: diagnostics.oomKilled,
          logs: diagnostics.logs,
          hint: diagnostics.hint,
        };
      }
      return podman.exec(sb.containerId, a.command as string);
    }
    case "run_container_command": {
      const image = (a.image as string)?.trim();
      const rawCmd = a.command;
      const command =
        typeof rawCmd === "string"
          ? rawCmd.trim()
          : Array.isArray(rawCmd)
            ? rawCmd.map(String).join(" ")
            : "";
      if (!image || !command) return { error: "image and command are required" };
      const runName = `chat-one-shot-${Date.now()}`;
      const mgr = getContainerManager();
      const isImageNotFound = (m: string) => {
        const s = m.toLowerCase();
        return (
          s.includes("no such image") ||
          s.includes("manifest unknown") ||
          s.includes("not found") ||
          s.includes("pull access denied") ||
          s.includes("unable to find image")
        );
      };
      let containerId: string;
      try {
        containerId = await mgr.create(image, runName, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isImageNotFound(msg)) {
          try {
            await mgr.pull(image);
            containerId = await mgr.create(image, runName, {});
          } catch (pullErr) {
            const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
            const enhanced = withContainerInstallHint(pullMsg);
            return {
              error: enhanced !== pullMsg ? enhanced : `Failed to pull/create: ${pullMsg}`,
              stdout: "",
              stderr: pullMsg,
              exitCode: -1,
            };
          }
        } else {
          const enhanced = withContainerInstallHint(msg);
          return {
            error: enhanced !== msg ? enhanced : `Failed to create container: ${msg}`,
            stdout: "",
            stderr: msg,
            exitCode: -1,
          };
        }
      }
      try {
        const result = await mgr.exec(containerId, command);
        return result;
      } finally {
        try {
          await mgr.destroy(containerId);
        } catch {
          /* ignore */
        }
      }
    }
    case "list_sandboxes": {
      const rows = await db.select().from(sandboxes);
      return rows.map(fromSandboxRow).map((s) => ({
        id: s.id,
        name: s.name,
        image: s.image,
        status: s.status,
        ...(s.containerId ? { containerId: s.containerId } : {}),
      }));
    }
    case "get_sandbox": {
      const sbId = a.sandboxId as string;
      if (!sbId) return { error: "sandboxId is required" };
      const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sbId));
      if (rows.length === 0) return { error: "Sandbox not found" };
      const sb = fromSandboxRow(rows[0]);
      const base = {
        id: sb.id,
        name: sb.name,
        image: sb.image,
        status: sb.status,
        ...(sb.containerId ? { containerId: sb.containerId } : {}),
      };
      if (!sb.containerId) {
        return { ...base, containerState: null, message: "Sandbox has no container" };
      }
      const podman = getContainerManager();
      const state = await podman.getContainerState(sb.containerId);
      if (state === "running") {
        return { ...base, containerState: "running" };
      }
      const diagnostics = await getExitDiagnostics(podman, sb.containerId);
      return {
        ...base,
        status: "exited",
        containerState: state,
        exitCode: diagnostics.exitCode,
        oomKilled: diagnostics.oomKilled,
        logs: diagnostics.logs,
        hint: diagnostics.hint,
      };
    }
    default:
      return undefined;
  }
}
