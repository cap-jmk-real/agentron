/**
 * Tool handlers for workflows, runs, reminders, assistant, tools, sandbox, improvement, and misc.
 * Cases: delete_workflow through cancel_reminder.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { resolveWorkflowIdFromArgs } from "./execute-tool-shared";
import type { RemoteServer } from "../../_lib/db";
import path from "node:path";
import fs from "node:fs";
import {
  db,
  getDataDir,
  workflows,
  workflowVersions,
  executions,
  agents,
  llmConfigs,
  files,
  sandboxes,
  customFunctions,
  tools,
  feedback,
  conversations,
  chatMessages,
  chatAssistantSettings,
  assistantMemory,
  improvementJobs,
  techniqueInsights,
  techniquePlaybook,
  trainingRuns,
  evalResults,
  guardrails,
  agentStoreEntries,
  reminders,
  remoteServers,
  fromWorkflowRow,
  toWorkflowRow,
  fromExecutionRow,
  toExecutionRow,
  executionOutputSuccess,
  executionOutputFailure,
  insertWorkflowMessage,
  getWorkflowMessages,
  fromReminderRow,
  toReminderRow,
  fromChatAssistantSettingsRow,
  toChatAssistantSettingsRow,
  fromAssistantMemoryRow,
  toAssistantMemoryRow,
  fromSandboxRow,
  toSandboxRow,
  fromFileRow,
  fromCustomFunctionRow,
  fromToolRow,
  toToolRow,
  toCustomFunctionRow,
  fromRemoteServerRow,
  toRemoteServerRow,
  toLlmConfigRow,
} from "../../_lib/db";
import {
  runWorkflow,
  RUN_CANCELLED_MESSAGE,
  WAITING_FOR_USER_MESSAGE,
  WaitingForUserError,
} from "../../_lib/run-workflow";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { enqueueWorkflowResume } from "../../_lib/workflow-queue";
import { getContainerManager, withContainerInstallHint } from "../../_lib/container-manager";
import { addSandboxSiteBinding } from "../../_lib/sandbox-site-bindings";
import { getStoredCredential } from "../../_lib/credential-store";
import { createRunNotification } from "../../_lib/notifications-store";
import { ensureRunFailureSideEffects } from "../../_lib/run-failure-side-effects";
import { scheduleReminder, cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { runShellCommand } from "../../_lib/shell-exec";
import { openclawSend, openclawHistory, openclawAbort } from "../../_lib/openclaw-client";
import { runOpenclawRpcInContainer } from "../../_lib/openclaw-in-container";
import { testRemoteConnection } from "../../_lib/remote-test";
import {
  getAppSettings,
  getShellCommandAllowlist,
  updateAppSettings,
} from "../../_lib/app-settings";
import { ensureRunnerSandboxId } from "./execute-tool-shared";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { searchWeb, fetchUrl, refinePrompt } from "@agentron-studio/runtime";

const DEFAULT_RECENT_SUMMARIES_COUNT = 3;
const MIN_SUMMARIES = 1;
const MAX_SUMMARIES = 10;

export type ExecuteToolFn = (
  name: string,
  args: Record<string, unknown>,
  ctx?: ExecuteToolContext
) => Promise<unknown>;

export async function executeToolHandlersWorkflowsRunsReminders(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined,
  executeToolRef?: ExecuteToolFn
): Promise<unknown | undefined> {
  const conversationId = ctx?.conversationId;
  const vaultKey = ctx?.vaultKey ?? null;

  switch (name) {
    case "delete_workflow": {
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const wfId = wfResolved.workflowId;
      const wfRows = await db
        .select({ id: workflows.id, name: workflows.name })
        .from(workflows)
        .where(eq(workflows.id, wfId));
      if (wfRows.length === 0) return { error: "Workflow not found" };
      await db.delete(workflows).where(eq(workflows.id, wfId)).run();
      return { id: wfId, message: `Workflow "${wfRows[0].name}" deleted` };
    }
    case "list_workflow_versions": {
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const wfId = wfResolved.workflowId;
      const exists = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, wfId))
        .limit(1);
      if (exists.length === 0) return { error: "Workflow not found" };
      const rows = await db
        .select({
          id: workflowVersions.id,
          version: workflowVersions.version,
          createdAt: workflowVersions.createdAt,
        })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, wfId))
        .orderBy(desc(workflowVersions.version));
      return rows.map((r) => ({ id: r.id, version: r.version, created_at: r.createdAt }));
    }
    case "rollback_workflow": {
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const wfId = wfResolved.workflowId;
      const versionId = a.versionId as string | undefined;
      const versionNum = typeof a.version === "number" ? a.version : undefined;
      const exists = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, wfId))
        .limit(1);
      if (exists.length === 0) return { error: "Workflow not found" };
      let versionRow:
        | { id: string; workflowId: string; version: number; snapshot: string }
        | undefined;
      if (versionId) {
        const rows = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, versionId))
          .limit(1);
        versionRow =
          rows.length > 0 && rows[0].workflowId === wfId
            ? (rows[0] as { id: string; workflowId: string; version: number; snapshot: string })
            : undefined;
      } else if (versionNum != null) {
        const rows = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, wfId));
        versionRow = rows.find((r) => r.version === versionNum) as
          | { id: string; workflowId: string; version: number; snapshot: string }
          | undefined;
      }
      if (!versionRow) return { error: "Version not found (provide versionId or version)" };
      let snapshot: Record<string, unknown>;
      try {
        snapshot = JSON.parse(versionRow.snapshot) as Record<string, unknown>;
      } catch {
        return { error: "Invalid snapshot" };
      }
      if (String(snapshot.id) !== wfId) return { error: "Snapshot does not match workflow" };
      await db
        .update(workflows)
        .set(snapshot as Record<string, unknown>)
        .where(eq(workflows.id, wfId))
        .run();
      return { id: wfId, version: versionRow.version, message: "Workflow rolled back" };
    }
    case "create_code_tool": {
      const nameStr = a.name != null && String(a.name).trim() ? String(a.name).trim() : "";
      const lang =
        a.language != null && String(a.language).trim()
          ? String(a.language).trim().toLowerCase()
          : "";
      const sourceStr = typeof a.source === "string" ? a.source : "";
      if (!nameStr) return { error: "name is required" };
      if (!["javascript", "python", "typescript"].includes(lang))
        return { error: "language must be javascript, python, or typescript" };
      if (!sourceStr) return { error: "source is required" };
      let sandboxId: string;
      try {
        sandboxId = await ensureRunnerSandboxId(lang);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: withContainerInstallHint(msg) };
      }
      const fnId = crypto.randomUUID();
      const fn = {
        id: fnId,
        name: nameStr,
        language: lang as "javascript" | "python" | "typescript",
        source: sourceStr,
        description:
          a.description != null && String(a.description).trim()
            ? String(a.description).trim()
            : undefined,
        sandboxId,
        createdAt: Date.now(),
      };
      await db.insert(customFunctions).values(toCustomFunctionRow(fn)).run();
      const toolId = `fn-${fnId}`;
      const tool = {
        id: toolId,
        name: fn.name,
        protocol: "native" as const,
        config: { functionId: fnId, language: fn.language },
        inputSchema:
          a.inputSchema != null && typeof a.inputSchema === "object"
            ? (a.inputSchema as Record<string, unknown>)
            : undefined,
        outputSchema: undefined,
      };
      await db.insert(tools).values(toToolRow(tool)).run();
      return {
        id: fnId,
        toolId,
        name: fn.name,
        message: `Code tool "${fn.name}" created. Tool id: ${toolId}. You can attach it to agents via update_agent with toolIds.`,
      };
    }
    case "list_custom_functions": {
      const fnRows = await db.select().from(customFunctions);
      const toolRows = await db.select({ id: tools.id, config: tools.config }).from(tools);
      const functionIdToToolId = new Map<string, string>();
      for (const row of toolRows) {
        const config =
          typeof row.config === "string"
            ? (JSON.parse(row.config || "{}") as Record<string, unknown>)
            : (row.config as Record<string, unknown>);
        const fid = config?.functionId as string | undefined;
        if (typeof fid === "string") functionIdToToolId.set(fid, row.id);
      }
      const list = fnRows.map((row) => {
        const fn = fromCustomFunctionRow(row);
        const toolId =
          functionIdToToolId.get(fn.id) ??
          (toolRows.some((t) => t.id === `fn-${fn.id}`) ? `fn-${fn.id}` : undefined);
        return {
          id: fn.id,
          name: fn.name,
          language: fn.language,
          description: fn.description ?? undefined,
          ...(toolId ? { toolId } : {}),
        };
      });
      return list;
    }
    case "get_custom_function": {
      const fid = typeof a.id === "string" ? a.id.trim() : "";
      if (!fid) return { error: "id is required" };
      const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, fid));
      if (fnRows.length === 0) return { error: "Custom function not found" };
      const fn = fromCustomFunctionRow(fnRows[0]);
      return {
        id: fn.id,
        name: fn.name,
        description: fn.description,
        language: fn.language,
        source: fn.source,
        sandboxId: fn.sandboxId,
      };
    }
    case "update_custom_function": {
      const fid = typeof a.id === "string" ? a.id.trim() : "";
      if (!fid) return { error: "id is required" };
      const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, fid));
      if (fnRows.length === 0) return { error: "Custom function not found" };
      const existing = fromCustomFunctionRow(fnRows[0]);
      const updated = { ...existing };
      if (a.source !== undefined) updated.source = String(a.source);
      if (a.name !== undefined) updated.name = String(a.name);
      if (a.description !== undefined)
        updated.description = String(a.description).trim() || undefined;
      if (a.sandboxId !== undefined)
        updated.sandboxId =
          typeof a.sandboxId === "string" && a.sandboxId.trim() ? a.sandboxId.trim() : undefined;
      await db
        .update(customFunctions)
        .set(toCustomFunctionRow(updated))
        .where(eq(customFunctions.id, fid))
        .run();
      return { id: fid, message: `Custom function "${updated.name}" updated` };
    }
    case "create_custom_function": {
      const id = crypto.randomUUID();
      const fn = {
        id,
        name: a.name as string,
        language: a.language as string,
        source: a.source as string,
        description: (a.description as string) || undefined,
        createdAt: Date.now(),
      };
      await db.insert(customFunctions).values(toCustomFunctionRow(fn)).run();
      return { id, name: fn.name, message: `Function "${fn.name}" created` };
    }
    case "create_sandbox": {
      const id = crypto.randomUUID();
      const name = (a.name as string) || `sandbox-${id.slice(0, 8)}`;
      const image = a.image as string;
      const envArg =
        a.env && typeof a.env === "object" && !Array.isArray(a.env)
          ? (a.env as Record<string, string>)
          : undefined;
      const config: { useImageCmd?: boolean; env?: Record<string, string>; cmd?: string[] } =
        typeof image === "string" && image.toLowerCase().includes("openclaw")
          ? (() => {
              // Break-glass: patch config so token-only Control UI connect works. Gateway listens on loopback:18788; proxy on 0.0.0.0:18789 forwards to it so gateway sees 127.0.0.1 (allowInsecureAuth allows then).
              const patchScript = [
                'const fs=require("fs");',
                'const paths=["/root/.openclaw/openclaw.json","/home/node/.openclaw/openclaw.json"];',
                'const strip=(s)=>s.replace(/\\/\\/[^\\n]*/g,"").replace(/\\/\\*[\\s\\S]*?\\*\\//g,"");',
                "let ok=false;",
                'for(const p of paths){try{const c=JSON.parse(strip(fs.readFileSync(p,"utf8")));c.gateway=c.gateway||{};c.gateway.port=18788;c.gateway.bind="loopback";c.gateway.controlUi=c.gateway.controlUi||{};c.gateway.controlUi.dangerouslyDisableDeviceAuth=true;c.gateway.controlUi.allowInsecureAuth=true;fs.writeFileSync(p,JSON.stringify(c,null,2));ok=true;}catch(e){}}',
                "if(!ok)process.exit(1);",
              ].join("");
              // Optional: configure Ollama/local model so the agent can reply without cloud API keys. Set OPENCLAW_AGENT_MODEL (e.g. ollama/llama3.3) and optionally OPENCLAW_OLLAMA_BASE_URL (e.g. http://host.containers.internal:11434/v1). Requires network so container can reach host.
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
              // TCP proxy: listen 0.0.0.0:18789, forward to 127.0.0.1:18788. Keep process alive (handle errors, no exit on listen failure).
              const proxyScript =
                'var n=require("net");var s=n.createServer(function(sock){var c=n.createConnection(18788,"127.0.0.1",function(){sock.pipe(c);c.pipe(sock)});c.on("error",function(){sock.destroy()});sock.on("error",function(){c.destroy()})});s.on("error",function(e){console.error("proxy error",e.message||e)});s.listen(18789,"0.0.0.0",function(){if(this.listening)process.stderr.write("proxy listening\\n")});setInterval(function(){},86400000)';
              // Single base64 startup script in env so -c string is minimal (avoids quoting/parsing on Windows).
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
              // Minimal -c: no nested && or quotes that can break under PowerShell/Windows.
              const cmdStr = 'echo "$OC_STARTUP_B64" | base64 -d | sh ; exec sleep infinity';
              const baseConfig: {
                useImageCmd: true;
                network?: boolean;
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
              if (useOllama) baseConfig.network = true;
              return baseConfig;
            })()
          : {};
      let containerId: string | undefined;
      let status = "creating";
      const podman = getContainerManager();
      try {
        containerId = await podman.create(image, name, config);
        status = "running";
      } catch (err) {
        status = "stopped";
        const msg = err instanceof Error ? err.message : String(err);
        if (withContainerInstallHint(msg) !== msg) {
          return { id, name, status: "stopped", message: withContainerInstallHint(msg) };
        }
      }
      await db
        .insert(sandboxes)
        .values(
          toSandboxRow({
            id,
            name,
            image,
            status: status as "running",
            containerId,
            config,
            createdAt: Date.now(),
          })
        )
        .run();
      return {
        id,
        name,
        status,
        message:
          status === "running"
            ? `Sandbox "${name}" running`
            : "Sandbox created but failed to start",
      };
    }
    case "execute_code": {
      const sbId = a.sandboxId as string;
      const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sbId));
      if (rows.length === 0) return { error: "Sandbox not found" };
      const sb = fromSandboxRow(rows[0]);
      if (!sb.containerId) return { error: "Sandbox has no container" };
      return getContainerManager().exec(sb.containerId, a.command as string);
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
      const name = `chat-one-shot-${Date.now()}`;
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
        containerId = await mgr.create(image, name, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isImageNotFound(msg)) {
          try {
            await mgr.pull(image);
            containerId = await mgr.create(image, name, {});
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
    case "bind_sandbox_port": {
      const sandboxId = (a.sandboxId as string)?.trim();
      const containerPort =
        typeof a.containerPort === "number"
          ? a.containerPort
          : parseInt(String(a.containerPort), 10);
      if (!sandboxId) return { error: "sandboxId is required" };
      if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535)
        return { error: "containerPort must be a number between 1 and 65535" };
      const host = (typeof a.host === "string" && (a.host as string).trim()) || "127.0.0.1";
      try {
        const { binding, warning } = await addSandboxSiteBinding(sandboxId, host, containerPort);
        const websocketUrl = `ws://${host}:${binding.hostPort}`;
        return {
          hostPort: binding.hostPort,
          websocketUrl,
          message:
            warning ??
            `Port ${containerPort} bound to host port ${binding.hostPort}. Use ${websocketUrl} to connect.`,
          ...(warning ? { warning } : {}),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: msg };
      }
    }
    case "list_sandboxes": {
      const rows = await db.select().from(sandboxes);
      return rows
        .map(fromSandboxRow)
        .map((s) => ({ id: s.id, name: s.name, image: s.image, status: s.status }));
    }
    case "list_files": {
      const rows = await db.select().from(files);
      return rows.map(fromFileRow).map((f) => ({ id: f.id, name: f.name, size: f.size }));
    }
    case "list_runs": {
      const rows = await db.select().from(executions);
      return rows.slice(-20).map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        status: r.status,
      }));
    }
    case "cancel_run": {
      const runId = typeof a.runId === "string" ? (a.runId as string).trim() : "";
      if (!runId) return { error: "runId is required" };
      const runRows = await db.select().from(executions).where(eq(executions.id, runId));
      if (runRows.length === 0) return { error: "Run not found" };
      const run = runRows[0];
      if (run.status !== "waiting_for_user" && run.status !== "running") {
        return { error: `Run cannot be cancelled (status: ${run.status})`, runId };
      }
      await db
        .update(executions)
        .set({ status: "cancelled", finishedAt: Date.now() })
        .where(eq(executions.id, runId))
        .run();
      return { id: runId, status: "cancelled", message: "Run cancelled." };
    }
    case "respond_to_run": {
      const runId = typeof a.runId === "string" ? (a.runId as string).trim() : "";
      const response = typeof a.response === "string" ? (a.response as string).trim() : "(no text)";
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "chat/route.ts:respond_to_run",
          message: "respond_to_run invoked",
          data: { runId, responseLen: response.length },
          hypothesisId: "H2_H3",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (!runId) return { error: "runId is required" };
      const runRows = await db.select().from(executions).where(eq(executions.id, runId));
      if (runRows.length === 0) return { error: "Run not found" };
      const run = runRows[0];
      if (run.status !== "waiting_for_user") {
        return { error: `Run is not waiting for user input (status: ${run.status})`, runId };
      }
      const current = (() => {
        try {
          const raw = run.output;
          return typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          return undefined;
        }
      })();
      const existingOutput =
        current &&
        typeof current === "object" &&
        !Array.isArray(current) &&
        current.output !== undefined
          ? current.output
          : undefined;
      const existingTrail = Array.isArray(current?.trail) ? current.trail : [];
      const mergedOutput = {
        ...(existingOutput && typeof existingOutput === "object" && !Array.isArray(existingOutput)
          ? existingOutput
          : {}),
        userResponded: true,
        response,
      };
      const outPayload = executionOutputSuccess(
        mergedOutput,
        existingTrail.length > 0 ? existingTrail : undefined
      );
      await db
        .update(executions)
        .set({ status: "running", finishedAt: null, output: JSON.stringify(outPayload) })
        .where(eq(executions.id, runId))
        .run();
      enqueueWorkflowResume({ runId, resumeUserResponse: response });
      return {
        id: runId,
        status: "running",
        message:
          "Response sent to run. The workflow continues. [View run](/runs/" +
          runId +
          ") to see progress.",
      };
    }
    case "get_run": {
      const runId = a.id as string;
      const runRows = await db.select().from(executions).where(eq(executions.id, runId));
      if (runRows.length === 0) return { error: "Run not found" };
      const run = runRows[0] as {
        id: string;
        targetType: string;
        targetId: string;
        status: string;
        startedAt: number;
        finishedAt: number | null;
        output: string | null;
      };
      const output = run.output
        ? (() => {
            try {
              return JSON.parse(run.output) as unknown;
            } catch {
              return run.output;
            }
          })()
        : undefined;
      return {
        id: run.id,
        targetType: run.targetType,
        targetId: run.targetId,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        output,
      };
    }
    case "get_run_messages": {
      const runIdArg =
        typeof (a as { runId?: string }).runId === "string"
          ? (a as { runId: string }).runId.trim()
          : "";
      if (!runIdArg) return { error: "runId is required" };
      const limit =
        typeof (a as { limit?: number }).limit === "number" && (a as { limit: number }).limit > 0
          ? Math.min(100, (a as { limit: number }).limit)
          : 50;
      const runRows = await db
        .select({ id: executions.id })
        .from(executions)
        .where(eq(executions.id, runIdArg));
      if (runRows.length === 0) return { error: "Run not found" };
      const messages = await getWorkflowMessages(runIdArg, limit);
      return { runId: runIdArg, messages };
    }
    case "get_run_for_improvement": {
      const runIdArg =
        typeof (a as { runId?: string }).runId === "string"
          ? (a as { runId: string }).runId.trim()
          : "";
      if (!runIdArg)
        return {
          error:
            "runId is required. Get a run ID from Runs in the sidebar or from a previous execute_workflow result (use execute_workflow.id).",
        };
      const includeFullLogs = (a as { includeFullLogs?: boolean }).includeFullLogs === true;
      return getRunForImprovement(runIdArg, { includeFullLogs });
    }
    case "get_feedback_for_scope": {
      const targetIdRaw =
        typeof (a as { targetId?: string }).targetId === "string"
          ? (a as { targetId: string }).targetId.trim()
          : "";
      const agentIdFallback =
        typeof (a as { agentId?: string }).agentId === "string"
          ? (a as { agentId: string }).agentId.trim()
          : "";
      const targetId = targetIdRaw || agentIdFallback;
      if (!targetId) return { error: "targetId or agentId is required" };
      const rawLabel =
        typeof (a as { label?: string }).label === "string"
          ? (a as { label: string }).label.trim()
          : "";
      const label = rawLabel === "good" || rawLabel === "bad" ? rawLabel : undefined;
      const limit =
        typeof (a as { limit?: number }).limit === "number" && (a as { limit: number }).limit > 0
          ? (a as { limit: number }).limit
          : undefined;
      return getFeedbackForScope(targetId, { label, limit });
    }
    case "execute_workflow": {
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "chat/route.ts:execute_workflow",
          message: "execute_workflow start",
          data: { hasVaultKey: !!vaultKey },
          hypothesisId: "vault_access",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const workflowId = wfResolved.workflowId;
      const branchId =
        typeof a.branchId === "string" && a.branchId.trim() ? (a.branchId as string) : undefined;
      const wfRows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (wfRows.length === 0) return { error: "Workflow not found" };
      const runId = crypto.randomUUID();
      const run = {
        id: runId,
        targetType: "workflow",
        targetId: workflowId,
        targetBranchId: branchId ?? null,
        conversationId: conversationId ?? null,
        status: "running",
      };
      await db.insert(executions).values(toExecutionRow(run)).run();
      try {
        const onStepComplete = async (
          trail: Array<{
            order: number;
            round?: number;
            nodeId: string;
            agentName: string;
            input?: unknown;
            output?: unknown;
            error?: string;
          }>,
          lastOutput: unknown
        ) => {
          const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
          await db
            .update(executions)
            .set({ output: JSON.stringify(payload) })
            .where(eq(executions.id, runId))
            .run();
        };
        const onProgress = async (
          state: { message: string; toolId?: string },
          currentTrail: Array<{
            order: number;
            round?: number;
            nodeId: string;
            agentName: string;
            input?: unknown;
            output?: unknown;
            error?: string;
          }>
        ) => {
          const payload = executionOutputSuccess(
            undefined,
            currentTrail.length > 0 ? currentTrail : undefined,
            state.message
          );
          await db
            .update(executions)
            .set({ output: JSON.stringify(payload) })
            .where(eq(executions.id, runId))
            .run();
        };
        const isCancelled = async () => {
          const rows = await db
            .select({ status: executions.status })
            .from(executions)
            .where(eq(executions.id, runId));
          return rows[0]?.status === "cancelled";
        };
        const { output, context, trail } = await runWorkflow({
          workflowId,
          runId,
          branchId,
          vaultKey: vaultKey ?? undefined,
          onStepComplete,
          onProgress,
          isCancelled,
        });
        const payload = executionOutputSuccess(output ?? context, trail);
        await db
          .update(executions)
          .set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) })
          .where(eq(executions.id, runId))
          .run();
        try {
          await createRunNotification(runId, "completed", {
            targetType: "workflow",
            targetId: workflowId,
          });
        } catch {
          // ignore
        }
        const updated = await db.select().from(executions).where(eq(executions.id, runId));
        const runResult = fromExecutionRow(updated[0]);
        return {
          id: runId,
          workflowId,
          status: "completed",
          message:
            "Workflow run completed. Check Runs in the sidebar for full output and execution trail.",
          output: runResult.output,
        };
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const cancelled = rawMessage === RUN_CANCELLED_MESSAGE;
        if (cancelled) {
          await db
            .update(executions)
            .set({ status: "cancelled", finishedAt: Date.now() })
            .where(eq(executions.id, runId))
            .run();
          return {
            id: runId,
            workflowId,
            status: "cancelled",
            message: "Run was stopped by the user.",
          };
        }
        if (rawMessage === WAITING_FOR_USER_MESSAGE) {
          // Preserve execution trail when request_user_help overwrote the run output (so run page shows progress)
          if (err instanceof WaitingForUserError && err.trail.length > 0) {
            try {
              const runRows = await db
                .select({ output: executions.output })
                .from(executions)
                .where(eq(executions.id, runId));
              const raw = runRows[0]?.output;
              const parsed =
                raw == null
                  ? {}
                  : typeof raw === "string"
                    ? (JSON.parse(raw) as Record<string, unknown>)
                    : (raw as Record<string, unknown>);
              const merged = { ...parsed, trail: err.trail };
              await db
                .update(executions)
                .set({ output: JSON.stringify(merged) })
                .where(eq(executions.id, runId))
                .run();
            } catch {
              // ignore
            }
          }
          // Forward the run's question/options so the chat UI can show them without a separate run-waiting request
          let question: string | undefined;
          let options: string[] = [];
          try {
            const runRows = await db
              .select({ output: executions.output })
              .from(executions)
              .where(eq(executions.id, runId));
            const raw = runRows[0]?.output;
            const out =
              raw == null
                ? undefined
                : typeof raw === "string"
                  ? (JSON.parse(raw) as Record<string, unknown>)
                  : (raw as Record<string, unknown>);
            if (out && typeof out === "object") {
              const inner =
                out.output && typeof out.output === "object" && out.output !== null
                  ? (out.output as Record<string, unknown>)
                  : out;
              const q = (typeof inner?.question === "string" ? inner.question : undefined)?.trim();
              const msg = (typeof inner?.message === "string" ? inner.message : undefined)?.trim();
              question =
                q || msg || (typeof out.question === "string" ? out.question.trim() : undefined);
              const opts = Array.isArray(inner?.suggestions)
                ? inner.suggestions
                : Array.isArray(inner?.options)
                  ? inner.options
                  : Array.isArray(out.suggestions)
                    ? out.suggestions
                    : undefined;
              options = opts?.map((o) => String(o)).filter(Boolean) ?? [];
            }
          } catch {
            // ignore
          }
          return {
            id: runId,
            workflowId,
            status: "waiting_for_user",
            message: "Run is waiting for user input. Respond from Chat or the run detail page.",
            ...(question && { question }),
            ...(options.length > 0 && { options }),
          };
        }
        const message = withContainerInstallHint(rawMessage);
        const payload = executionOutputFailure(message, {
          message,
          stack: err instanceof Error ? err.stack : undefined,
        });
        await db
          .update(executions)
          .set({ status: "failed", finishedAt: Date.now(), output: JSON.stringify(payload) })
          .where(eq(executions.id, runId))
          .run();
        try {
          await ensureRunFailureSideEffects(runId, {
            targetType: "workflow",
            targetId: workflowId,
          });
        } catch {
          // ignore
        }
        return {
          id: runId,
          workflowId,
          status: "failed",
          error: message,
          message: `Workflow run failed: ${message}`,
        };
      }
    }
    case "web_search": {
      const query = typeof a.query === "string" ? (a.query as string).trim() : "";
      if (!query) return { error: "query is required", results: [] };
      const maxResults =
        typeof a.maxResults === "number" && a.maxResults > 0
          ? Math.min(a.maxResults, 20)
          : undefined;
      const appSettings = getAppSettings();
      const searchOptions: Parameters<typeof searchWeb>[1] = {
        maxResults,
        provider: appSettings.webSearchProvider,
        braveApiKey: appSettings.braveSearchApiKey,
        googleCseKey: appSettings.googleCseKey,
        googleCseCx: appSettings.googleCseCx,
      };
      try {
        const out = await searchWeb(query, searchOptions);
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Web search failed", message, results: [] };
      }
    }
    case "fetch_url": {
      const url = typeof a.url === "string" ? (a.url as string).trim() : "";
      if (!url) return { error: "url is required" };
      try {
        return await fetchUrl({ url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: "Fetch failed", message };
      }
    }
    case "answer_question": {
      // Pass through — the LLM already has the question in context.
      // Return a signal so the follow-up LLM call can produce the real answer.
      return { message: "Answering general question", question: a.question as string };
    }
    case "explain_software": {
      const topic = ((a.topic as string) || "general").toLowerCase();
      const docs: Record<string, string> = {
        general:
          "AgentOS Studio is a local-first platform for building, managing, and running AI agents. It supports agents (with customizable prompts and steps), workflows (chaining agents together), tools (native, MCP, HTTP), custom code functions, Podman-based sandboxes for code execution, file context for agents, feedback-driven learning, and an AI chat assistant.",
        agents:
          "Agents are the core building blocks. Each agent has a kind (node or code), a protocol (native, MCP, HTTP), a system prompt, optional steps, and can be connected to tools and LLMs. Agents can learn from user feedback — thumbs up/down on their outputs refines their prompts over time.",
        workflows:
          "Workflows chain multiple agents together into a pipeline. They support execution modes: one_time, continuous, or interval. Agents within a workflow share context so outputs from one agent can be used by the next.",
        tools:
          "Tools extend what agents can do. They can be native (built-in), MCP (Model Context Protocol), or HTTP (external APIs). Custom code functions also register as native tools automatically.",
        sandboxes:
          "Sandboxes are Podman or Docker containers that provide isolated execution environments. The user chooses the engine in Settings → Container Engine. They support any language or runtime — just specify a container image. You can execute commands, mount files, and even run databases inside them. If the user needs to install Podman or Docker, direct them to the installation guide: [Container engine (Podman & Docker)](/podman-install).",
        functions:
          "Custom functions let you write code (JavaScript, Python, TypeScript) that becomes a tool agents can call. Functions run inside sandboxes for isolation.",
        files:
          "You can upload context files that agents can access during execution. Files are stored locally and can be mounted into sandboxes. The assistant can also create files with std-write-file (name and content); use the returned contextDir with std-container-build to build images from a Containerfile, or pass dockerfileContent to std-container-build for a one-step build.",
        feedback:
          "The feedback system lets you rate agent outputs as good or bad. This feedback is used in two ways: runtime injection (few-shot examples added to prompts) and on-demand LLM-driven prompt refinement.",
      };
      const explanation = docs[topic] || docs.general;
      return { message: explanation, topic };
    }
    case "run_shell_command": {
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
    case "list_remote_servers": {
      const rows = await db.select().from(remoteServers);
      return {
        servers: rows.map(fromRemoteServerRow).map((s) => ({
          id: s.id,
          label: s.label,
          host: s.host,
          port: s.port,
          user: s.user,
          authType: s.authType,
          modelBaseUrl: s.modelBaseUrl,
        })),
      };
    }
    case "test_remote_connection": {
      const host = a.host as string;
      const user = a.user as string;
      if (!host || !user) return { error: "host and user are required" };
      return testRemoteConnection({
        host,
        port: a.port as number | undefined,
        user,
        authType: (a.authType as string) || "key",
        keyPath: a.keyPath as string | undefined,
      });
    }
    case "save_remote_server": {
      const id = crypto.randomUUID();
      const server: RemoteServer = {
        id,
        label: (a.label as string) || "Remote server",
        host: a.host as string,
        port: Number(a.port) || 22,
        user: a.user as string,
        authType: a.authType === "password" ? "password" : "key",
        keyPath: (a.keyPath as string) || undefined,
        modelBaseUrl: (a.modelBaseUrl as string) || undefined,
        createdAt: Date.now(),
      };
      await db.insert(remoteServers).values(toRemoteServerRow(server)).run();
      return {
        id,
        message: `Saved remote server "${server.label}". You can use it when creating new agents. Passwords are not stored; for password auth the user will be prompted when using this server.`,
        server: {
          id: server.id,
          label: server.label,
          host: server.host,
          port: server.port,
          user: server.user,
        },
      };
    }
    case "remember": {
      const value = (a.value as string)?.trim();
      if (!value) return { error: "value is required" };
      const key = typeof a.key === "string" ? a.key.trim() || null : null;
      const id = crypto.randomUUID();
      await db
        .insert(assistantMemory)
        .values(toAssistantMemoryRow({ id, key, content: value, createdAt: Date.now() }))
        .run();
      return {
        id,
        message: key
          ? `Remembered "${key}": ${value.slice(0, 80)}${value.length > 80 ? "…" : ""}`
          : `Remembered: ${value.slice(0, 80)}${value.length > 80 ? "…" : ""}`,
      };
    }
    case "get_assistant_setting": {
      const key = a.key as string;
      if (key !== "recentSummariesCount") return { error: "Unsupported setting key" };
      const rows = await db
        .select()
        .from(chatAssistantSettings)
        .where(eq(chatAssistantSettings.id, "default"));
      const settings = rows.length > 0 ? fromChatAssistantSettingsRow(rows[0]) : null;
      const count = settings?.recentSummariesCount ?? DEFAULT_RECENT_SUMMARIES_COUNT;
      return { key, value: count };
    }
    case "set_assistant_setting": {
      const key = a.key as string;
      if (key !== "recentSummariesCount") return { error: "Unsupported setting key" };
      let value = Number(a.value);
      if (Number.isNaN(value) || value < MIN_SUMMARIES || value > MAX_SUMMARIES) {
        value = Math.max(MIN_SUMMARIES, Math.min(MAX_SUMMARIES, Math.round(value)));
      } else {
        value = Math.round(value);
      }
      const rows = await db
        .select()
        .from(chatAssistantSettings)
        .where(eq(chatAssistantSettings.id, "default"));
      const now = Date.now();
      if (rows.length === 0) {
        await db
          .insert(chatAssistantSettings)
          .values(
            toChatAssistantSettingsRow({
              id: "default",
              customSystemPrompt: null,
              contextAgentIds: null,
              contextWorkflowIds: null,
              contextToolIds: null,
              recentSummariesCount: value,
              temperature: null,
              historyCompressAfter: null,
              historyKeepRecent: null,
              plannerRecentMessages: null,
              ragRetrieveLimit: null,
              feedbackLastN: null,
              feedbackRetrieveCap: null,
              feedbackMinScore: null,
              updatedAt: now,
            })
          )
          .run();
      } else {
        await db
          .update(chatAssistantSettings)
          .set({ recentSummariesCount: value, updatedAt: now })
          .where(eq(chatAssistantSettings.id, "default"))
          .run();
      }
      return {
        key,
        value,
        message: `Set ${key} to ${value}. Up to ${value} recent conversation summaries will be included in context.`,
      };
    }
    case "create_improvement_job": {
      const id = crypto.randomUUID();
      await db
        .insert(improvementJobs)
        .values({
          id,
          name: typeof a.name === "string" ? a.name : null,
          scopeType: typeof a.scopeType === "string" ? a.scopeType : null,
          scopeId: typeof a.scopeId === "string" ? a.scopeId : null,
          studentLlmConfigId:
            typeof a.studentLlmConfigId === "string" ? a.studentLlmConfigId : null,
          teacherLlmConfigId:
            typeof a.teacherLlmConfigId === "string" ? a.teacherLlmConfigId : null,
          currentModelRef: null,
          instanceRefs: null,
          architectureSpec: null,
          lastTrainedAt: null,
          lastFeedbackAt: null,
          createdAt: Date.now(),
        })
        .run();
      return { id, message: "Improvement job created." };
    }
    case "get_improvement_job": {
      const jobId = a.id as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const r = rows[0];
      const instanceRefs = r.instanceRefs
        ? (() => {
            try {
              return JSON.parse(r.instanceRefs) as string[];
            } catch {
              return [];
            }
          })()
        : [];
      const architectureSpec = r.architectureSpec
        ? (() => {
            try {
              return JSON.parse(r.architectureSpec) as Record<string, unknown>;
            } catch {
              return undefined;
            }
          })()
        : undefined;
      return {
        id: r.id,
        name: r.name,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        studentLlmConfigId: r.studentLlmConfigId,
        teacherLlmConfigId: r.teacherLlmConfigId,
        currentModelRef: r.currentModelRef,
        instanceRefs,
        architectureSpec,
        lastTrainedAt: r.lastTrainedAt,
        lastFeedbackAt: r.lastFeedbackAt,
        createdAt: r.createdAt,
      };
    }
    case "list_improvement_jobs": {
      const rows = await db.select().from(improvementJobs).orderBy(desc(improvementJobs.createdAt));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        currentModelRef: r.currentModelRef,
        lastTrainedAt: r.lastTrainedAt,
      }));
    }
    case "update_improvement_job": {
      const jobId = a.id as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const updates: Record<string, unknown> = {};
      if (a.currentModelRef !== undefined) updates.currentModelRef = a.currentModelRef;
      if (Array.isArray(a.instanceRefs)) updates.instanceRefs = JSON.stringify(a.instanceRefs);
      if (a.architectureSpec != null && typeof a.architectureSpec === "object")
        updates.architectureSpec = JSON.stringify(a.architectureSpec);
      if (typeof a.lastTrainedAt === "number") updates.lastTrainedAt = a.lastTrainedAt;
      if (Object.keys(updates).length === 0) return { id: jobId, message: "No updates" };
      await db
        .update(improvementJobs)
        .set(updates as Record<string, unknown>)
        .where(eq(improvementJobs.id, jobId))
        .run();
      return { id: jobId, message: "Job updated." };
    }
    case "generate_training_data": {
      const strategy = (a.strategy as string) || "from_feedback";
      const scopeType = (a.scopeType as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const jobId = (a.jobId as string) || "";
      const since = typeof a.since === "number" ? a.since : undefined;
      const improvementDir = path.join(getDataDir(), "improvement");
      fs.mkdirSync(improvementDir, { recursive: true });

      if (strategy === "from_feedback") {
        const feedbackRows = await db
          .select()
          .from(feedback)
          .where(scopeId ? eq(feedback.targetId, scopeId) : isNotNull(feedback.id))
          .orderBy(desc(feedback.createdAt));
        const filtered = since ? feedbackRows.filter((f) => f.createdAt >= since) : feedbackRows;
        const slice = filtered.slice(0, 500);
        const filename = `from_feedback_${Date.now()}.jsonl`;
        const datasetRef = path.join(improvementDir, filename);
        const lines = slice.map((f) =>
          JSON.stringify({
            targetType: f.targetType,
            targetId: f.targetId,
            executionId: f.executionId,
            input: f.input,
            output: f.output,
            label: f.label,
            notes: f.notes,
            createdAt: f.createdAt,
          })
        );
        fs.writeFileSync(datasetRef, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
        return {
          datasetRef,
          strategy,
          count: slice.length,
          message: `Generated ${slice.length} feedback rows for training. Use datasetRef with trigger_training.`,
        };
      }

      if (strategy === "from_runs") {
        if (!scopeId) {
          return {
            error:
              "generate_training_data with strategy from_runs requires scopeId (agent or workflow id).",
          };
        }
        const runRows = await db
          .select()
          .from(executions)
          .where(eq(executions.targetId, scopeId))
          .orderBy(desc(executions.startedAt))
          .limit(100);
        const examples: Array<{
          runId: string;
          targetType: string;
          targetId: string;
          trail?: unknown;
          output?: unknown;
        }> = [];
        for (const row of runRows) {
          const runContext = await getRunForImprovement(row.id, { includeFullLogs: true });
          if ("error" in runContext) continue;
          examples.push({
            runId: runContext.id,
            targetType: runContext.targetType,
            targetId: runContext.targetId,
            trail: runContext.trail,
            output: runContext.output,
          });
        }
        const filename = `from_runs_${Date.now()}.jsonl`;
        const datasetRef = path.join(improvementDir, filename);
        const lines = examples.map((ex) => JSON.stringify(ex));
        fs.writeFileSync(datasetRef, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
        return {
          datasetRef,
          strategy,
          count: examples.length,
          message: `Generated ${examples.length} run trajectory examples. Use datasetRef with trigger_training.`,
        };
      }

      return {
        datasetRef: path.join(improvementDir, `${strategy}_${Date.now()}.jsonl`),
        strategy,
        message:
          "Dataset ref created; use trigger_training with this ref. Teacher/self_play require external data generation.",
      };
    }
    case "evaluate_model": {
      const jobId = (a.jobId as string)?.trim();
      if (!jobId) return { error: "evaluate_model requires jobId." };
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const instanceRef = (a.instanceRef as string)?.trim() || null;
      const evalSetRef = (a.evalSetRef as string)?.trim() || null;
      const metrics = { accuracy: 0, loss: null as number | null };
      const evalId = crypto.randomUUID();
      await db
        .insert(evalResults)
        .values({
          id: evalId,
          jobId,
          trainingRunId: null,
          instanceRef,
          evalSetRef,
          metrics: JSON.stringify(metrics),
          createdAt: Date.now(),
        })
        .run();
      return {
        evalId,
        jobId,
        metrics,
        message:
          "Eval result persisted. Plug in eval set and run student for real metrics; then metrics will be stored in eval_results.",
      };
    }
    case "trigger_training": {
      const raw = a.jobId ?? a.job_id;
      const jobId = typeof raw === "string" ? raw.trim() : "";
      if (!jobId) {
        return {
          error:
            "trigger_training requires jobId. Create an improvement job with create_improvement_job first, then pass its id.",
        };
      }
      const jobRows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (jobRows.length === 0) {
        return { error: "Job not found" };
      }
      const datasetRef = (a.datasetRef as string) || "";
      const backend = (a.backend as string) || "local";
      const addInstance = !!a.addInstance;
      const experimentLabel =
        typeof a.experimentLabel === "string" ? a.experimentLabel.trim() : undefined;
      const runId = crypto.randomUUID();
      const localUrl = process.env.LOCAL_TRAINER_URL || "http://localhost:8765";
      const runConfig: { addInstance: boolean; experimentLabel?: string } = { addInstance };
      if (experimentLabel) runConfig.experimentLabel = experimentLabel;
      if (backend === "local") {
        try {
          const res = await fetch(`${localUrl}/train`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, datasetRef, runId }),
          });
          const data = await res.json().catch(() => ({}));
          const extId = (data.run_id ?? data.id ?? runId) as string;
          if (typeof jobId !== "string" || !jobId)
            return { error: "trigger_training requires a valid jobId." };
          await db
            .insert(trainingRuns)
            .values({
              id: runId,
              jobId,
              backend: "local",
              status: "pending",
              datasetRef,
              outputModelRef: null,
              config: JSON.stringify(runConfig),
              createdAt: Date.now(),
              finishedAt: null,
            })
            .run();
          return {
            runId,
            backend,
            status: "pending",
            message: `Training started. Poll get_training_status(runId: ${runId}) for completion.`,
          };
        } catch {
          if (typeof jobId !== "string" || !jobId)
            return { error: "trigger_training requires a valid jobId." };
          await db
            .insert(trainingRuns)
            .values({
              id: runId,
              jobId,
              backend: "local",
              status: "pending",
              datasetRef,
              outputModelRef: null,
              config: JSON.stringify(runConfig),
              createdAt: Date.now(),
              finishedAt: null,
            })
            .run();
          return {
            runId,
            backend,
            status: "pending",
            message: `Training run created (local trainer at ${localUrl} may be unavailable). Poll get_training_status(runId: ${runId}).`,
          };
        }
      }
      if (typeof jobId !== "string" || !jobId)
        return { error: "trigger_training requires a valid jobId." };
      await db
        .insert(trainingRuns)
        .values({
          id: runId,
          jobId,
          backend,
          status: "pending",
          datasetRef,
          outputModelRef: null,
          config: JSON.stringify(runConfig),
          createdAt: Date.now(),
          finishedAt: null,
        })
        .run();
      return {
        runId,
        backend,
        status: "pending",
        message: `Training run created. Poll get_training_status(runId: ${runId}) for replicate/huggingface.`,
      };
    }
    case "get_training_status": {
      const runId = (a.runId as string) || "";
      const rows = await db.select().from(trainingRuns).where(eq(trainingRuns.id, runId));
      if (rows.length === 0) return { error: "Run not found" };
      const r = rows[0];
      if (r.backend === "local" && (r.status === "pending" || r.status === "running")) {
        const localUrl = process.env.LOCAL_TRAINER_URL || "http://localhost:8765";
        try {
          const res = await fetch(`${localUrl}/status/${encodeURIComponent(runId)}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              status?: string;
              output_model_ref?: string | null;
              outputModelRef?: string | null;
            };
            const status = data.status ?? r.status;
            const outputModelRef = data.output_model_ref ?? data.outputModelRef ?? r.outputModelRef;
            const finishedAt =
              status === "completed" || status === "failed" ? Date.now() : r.finishedAt;
            await db
              .update(trainingRuns)
              .set({
                status,
                outputModelRef: outputModelRef ?? null,
                finishedAt,
              })
              .where(eq(trainingRuns.id, runId))
              .run();
            return {
              runId: r.id,
              status,
              outputModelRef: outputModelRef ?? null,
              finishedAt,
            };
          }
        } catch {
          // Trainer unreachable; return current DB state
        }
      }
      return {
        runId: r.id,
        status: r.status,
        outputModelRef: r.outputModelRef,
        finishedAt: r.finishedAt,
      };
    }
    case "decide_optimization_target": {
      const scopeType = (a.scopeType as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      return {
        target: "model_instance",
        scope: scopeType,
        reason:
          "Use model_instance to generate data and trigger training; use prompt when only instructions need change.",
        optionalSpec: null,
      };
    }
    case "get_technique_knowledge": {
      const jobId = (a.jobId as string) || "";
      const playbookRows = await db.select().from(techniquePlaybook);
      let playbook = playbookRows.map((p) => ({
        name: p.name,
        description: p.description,
        whenToUse: p.whenToUse,
        downsides: p.downsides,
      }));
      if (playbook.length === 0) {
        playbook = [
          {
            name: "Teacher distillation",
            description:
              "Use a stronger LLM to produce trajectories; train small model to imitate. Cold start before any RL.",
            whenToUse: "When the student has no prior agentic data.",
            downsides: "Requires teacher inference cost.",
          },
          {
            name: "LoRA/DoRA",
            description: "Low-rank adapters; only a small set of parameters updated.",
            whenToUse: "Prefer for add-instance and memory-constrained training.",
            downsides: "May underfit if rank too low.",
          },
          {
            name: "from_feedback",
            description: "Training data from user ratings (good/bad) and run outcomes.",
            whenToUse: "When you have feedback in the feedback table for the scope.",
            downsides: "Needs enough feedback; sparse signal.",
          },
          {
            name: "Contrastive",
            description: "Train on both positive and negative traces.",
            whenToUse: "When you have both good and bad runs.",
            downsides: "Can cause instability if feedback count is low.",
          },
          {
            name: "Multi-instance",
            description: "Spawn multiple instances; do not overwrite single model.",
            whenToUse: "To avoid capability collapse; specialization per tool/task.",
            downsides: "More compute and routing logic.",
          },
        ];
      }
      const insights = jobId
        ? await db
            .select()
            .from(techniqueInsights)
            .where(eq(techniqueInsights.jobId, jobId))
            .orderBy(desc(techniqueInsights.createdAt))
        : [];
      return {
        playbook,
        recentInsights: insights.slice(0, 10).map((i) => ({
          techniqueOrStrategy: i.techniqueOrStrategy,
          outcome: i.outcome,
          summary: i.summary,
        })),
      };
    }
    case "record_technique_insight": {
      const id = crypto.randomUUID();
      await db
        .insert(techniqueInsights)
        .values({
          id,
          jobId: (a.jobId as string) || "",
          runId: typeof a.runId === "string" ? a.runId : null,
          techniqueOrStrategy: (a.techniqueOrStrategy as string) || "",
          outcome: (a.outcome as string) || "neutral",
          summary: (a.summary as string) || "",
          config: a.config != null ? JSON.stringify(a.config) : null,
          createdAt: Date.now(),
        })
        .run();
      return { id, message: "Insight recorded." };
    }
    case "propose_architecture": {
      const raw = a.jobId ?? a.job_id;
      const jobId = typeof raw === "string" ? raw.trim() : "";
      if (!jobId)
        return {
          error:
            "propose_architecture requires jobId. Create an improvement job with create_improvement_job first.",
        };
      const spec = a.spec as Record<string, unknown>;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      await db
        .update(improvementJobs)
        .set({ architectureSpec: JSON.stringify(spec || {}) })
        .where(eq(improvementJobs.id, jobId))
        .run();
      return {
        jobId,
        message:
          "Architecture spec attached to job. Next trigger_training will pass it to the backend if supported.",
      };
    }
    case "spawn_instance": {
      if (executeToolRef)
        return executeToolRef("trigger_training", { ...a, addInstance: true }, ctx);
      return { error: "spawn_instance requires executeTool ref" };
    }
    case "register_trained_model": {
      const outputModelRef = (a.outputModelRef as string)?.trim();
      if (!outputModelRef) return { error: "register_trained_model requires outputModelRef." };
      const label = (a.name as string)?.trim() || `trained-${Date.now()}`;
      const id = `llm-trained-${crypto.randomUUID().slice(0, 8)}`;
      const row = toLlmConfigRow({
        id,
        provider: "local",
        model: outputModelRef,
        apiKeyRef: undefined,
        endpoint: undefined,
        extra: undefined,
      });
      await db.insert(llmConfigs).values(row).run();
      const jobId = (a.jobId as string)?.trim();
      return {
        llmConfigId: id,
        outputModelRef,
        message: `Registered as LLM config ${id}. Use update_improvement_job(currentModelRef or instanceRefs) or update_agent(llmConfigId) to attach.`,
        ...(jobId ? { jobId } : {}),
      };
    }
    case "list_specialist_models": {
      const agentId = (a.agentId as string)?.trim();
      if (!agentId) return { error: "list_specialist_models requires agentId." };
      const rows = await db
        .select()
        .from(improvementJobs)
        .where(and(eq(improvementJobs.scopeType, "agent"), eq(improvementJobs.scopeId, agentId)));
      const result = rows.map((r) => {
        const instanceRefs = r.instanceRefs
          ? (() => {
              try {
                return JSON.parse(r.instanceRefs) as string[];
              } catch {
                return [];
              }
            })()
          : [];
        return {
          jobId: r.id,
          jobName: r.name,
          currentModelRef: r.currentModelRef,
          instanceRefs,
          lastTrainedAt: r.lastTrainedAt,
        };
      });
      return { agentId, jobs: result };
    }
    case "create_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const name = (a.name as string) || "";
      if (!scopeId || !name) return { error: "scopeId and name required" };
      return {
        message: "Store is created when you first put_store a key. No separate create needed.",
      };
    }
    case "put_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const key = (a.key as string) || "";
      const value = typeof a.value === "string" ? a.value : JSON.stringify(a.value ?? "");
      const id = crypto.randomUUID();
      const existing = await db
        .select()
        .from(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName),
            eq(agentStoreEntries.key, key)
          )
        );
      if (existing.length > 0) {
        await db
          .update(agentStoreEntries)
          .set({ value, createdAt: Date.now() })
          .where(eq(agentStoreEntries.id, existing[0].id))
          .run();
        return { message: "Updated." };
      }
      await db
        .insert(agentStoreEntries)
        .values({ id, scope, scopeId, storeName, key, value, createdAt: Date.now() })
        .run();
      return { message: "Stored." };
    }
    case "get_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const key = (a.key as string) || "";
      const rows = await db
        .select()
        .from(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName),
            eq(agentStoreEntries.key, key)
          )
        );
      if (rows.length === 0) return { error: "Key not found" };
      return { value: rows[0].value };
    }
    case "query_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const prefix = (a.prefix as string) || "";
      const rows = await db
        .select()
        .from(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName)
          )
        );
      const filtered = prefix ? rows.filter((r) => r.key.startsWith(prefix)) : rows;
      return { entries: filtered.map((r) => ({ key: r.key, value: r.value })) };
    }
    case "list_stores": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const rows = await db
        .select({ storeName: agentStoreEntries.storeName })
        .from(agentStoreEntries)
        .where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId)));
      const names = [...new Set(rows.map((r) => r.storeName))];
      return { stores: names };
    }
    case "delete_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      await db
        .delete(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName)
          )
        )
        .run();
      return { message: "Store deleted." };
    }
    case "create_guardrail": {
      const id = crypto.randomUUID();
      const scope = (a.scope as string) || "deployment";
      const scopeId = (a.scopeId as string) || null;
      const config =
        a.config != null && typeof a.config === "object"
          ? (a.config as Record<string, unknown>)
          : {};
      await db
        .insert(guardrails)
        .values({ id, scope, scopeId, config: JSON.stringify(config), createdAt: Date.now() })
        .run();
      return {
        id,
        message: "Guardrail created. It will be applied when the agent uses fetch/browser.",
      };
    }
    case "list_guardrails": {
      const scope = a.scope as string | undefined;
      const scopeId = a.scopeId as string | undefined;
      let rows = await db.select().from(guardrails);
      if (scope) rows = rows.filter((r) => r.scope === scope);
      if (scopeId) rows = rows.filter((r) => r.scopeId === scopeId);
      return {
        guardrails: rows.map((r) => ({
          id: r.id,
          scope: r.scope,
          scopeId: r.scopeId,
          config: r.config,
        })),
      };
    }
    case "get_guardrail": {
      const gid = a.id as string;
      const rows = await db.select().from(guardrails).where(eq(guardrails.id, gid));
      if (rows.length === 0) return { error: "Guardrail not found" };
      const r = rows[0];
      return {
        id: r.id,
        scope: r.scope,
        scopeId: r.scopeId,
        config: typeof r.config === "string" ? JSON.parse(r.config) : r.config,
      };
    }
    case "update_guardrail": {
      const gid = a.id as string;
      const config =
        a.config != null && typeof a.config === "object" ? JSON.stringify(a.config) : undefined;
      if (!config) return { error: "config required" };
      await db.update(guardrails).set({ config }).where(eq(guardrails.id, gid)).run();
      return { id: gid, message: "Guardrail updated." };
    }
    case "delete_guardrail": {
      const gid = a.id as string;
      await db.delete(guardrails).where(eq(guardrails.id, gid)).run();
      return { message: "Guardrail deleted." };
    }
    case "send_to_openclaw": {
      const content =
        (typeof a.content === "string" && a.content.trim()) ||
        (typeof a.message === "string" && a.message.trim()) ||
        (typeof (a as { text?: string }).text === "string" &&
          (a as { text?: string }).text?.trim()) ||
        (() => {
          for (const v of Object.values(a)) {
            if (typeof v === "string" && v.trim() && !v.startsWith("ws://")) return v.trim();
          }
          return "";
        })();
      if (!content) return { error: "content is required" };
      const sandboxId = (a.sandboxId as string)?.trim();
      if (sandboxId) {
        const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxId));
        if (rows.length === 0) return { error: "Sandbox not found" };
        const sb = fromSandboxRow(rows[0]);
        if (!sb.containerId) return { error: "Sandbox has no container" };
        if (!sb.image?.toLowerCase().includes("openclaw"))
          return { error: "Sandbox is not an OpenClaw container" };
        const podman = getContainerManager();
        const { payload, error } = await runOpenclawRpcInContainer(
          sb.containerId,
          "chat.send",
          {
            sessionKey: "default",
            message: content,
            idempotencyKey: `agentron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          },
          (cid, cmd) => podman.exec(cid, cmd)
        );
        if (error) {
          const hint =
            error.includes("running containers") || error.includes("container state")
              ? " Container may have stopped or exec failed. Check container logs."
              : " Make sure the OpenClaw Gateway is running in the container (e.g. create_sandbox with OpenClaw image).";
          return {
            error: `OpenClaw: ${error}`,
            message: hint.trim(),
          };
        }
        const result = payload as { runId?: string; status?: string };
        return {
          ...result,
          message: result?.runId ? "Message sent to OpenClaw." : (result?.status ?? "Sent."),
        };
      }
      const gatewayUrl =
        typeof a.gatewayUrl === "string" ? (a.gatewayUrl as string).trim() : undefined;
      let url = gatewayUrl;
      let token: string | undefined;
      if (vaultKey) {
        const vaultUrl = await getStoredCredential("openclaw_gateway_url", vaultKey);
        const vaultToken = await getStoredCredential("openclaw_gateway_token", vaultKey);
        if (!url && vaultUrl) url = vaultUrl;
        if (vaultToken) token = vaultToken;
      }
      try {
        const result = await openclawSend(content, { url, token });
        return {
          ...result,
          message: result.runId ? "Message sent to OpenClaw." : (result.message ?? "Sent."),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          error: `OpenClaw: ${msg}`,
          message:
            "Make sure the OpenClaw Gateway is running (e.g. openclaw gateway) and OPENCLAW_GATEWAY_URL/OPENCLAW_GATEWAY_TOKEN are set if needed.",
        };
      }
    }
    case "openclaw_history": {
      const sandboxIdHist = (a.sandboxId as string)?.trim();
      if (sandboxIdHist) {
        const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxIdHist));
        if (rows.length === 0) return { error: "Sandbox not found", messages: [] };
        const sb = fromSandboxRow(rows[0]);
        if (!sb.containerId) return { error: "Sandbox has no container", messages: [] };
        if (!sb.image?.toLowerCase().includes("openclaw"))
          return { error: "Sandbox is not an OpenClaw container", messages: [] };
        const limit = typeof a.limit === "number" && a.limit > 0 ? Math.min(a.limit, 50) : 20;
        const podman = getContainerManager();
        const { payload, error } = await runOpenclawRpcInContainer(
          sb.containerId,
          "chat.history",
          { sessionKey: "default", limit },
          (cid, cmd) => podman.exec(cid, cmd)
        );
        if (error) return { error: `OpenClaw: ${error}`, messages: [] };
        const raw = payload as
          | { messages?: Array<{ role?: string; content?: string }> }
          | Array<{ role?: string; content?: string }>;
        const messages = Array.isArray(raw) ? raw : (raw?.messages ?? []);
        return {
          messages,
          message: `Last ${messages.length} message(s) from OpenClaw.`,
        };
      }
      const gatewayUrl =
        typeof a.gatewayUrl === "string" ? (a.gatewayUrl as string).trim() : undefined;
      let url = gatewayUrl;
      let token: string | undefined;
      if (vaultKey) {
        const vaultUrl = await getStoredCredential("openclaw_gateway_url", vaultKey);
        const vaultToken = await getStoredCredential("openclaw_gateway_token", vaultKey);
        if (!url && vaultUrl) url = vaultUrl;
        if (vaultToken) token = vaultToken;
      }
      try {
        const limit = typeof a.limit === "number" && a.limit > 0 ? Math.min(a.limit, 50) : 20;
        const result = await openclawHistory({ limit, url, token });
        if (result.error) return { error: result.error, messages: [] };
        return {
          messages: result.messages ?? [],
          message: `Last ${(result.messages ?? []).length} message(s) from OpenClaw.`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}`, messages: [] };
      }
    }
    case "openclaw_abort": {
      const sandboxIdAbort = (a.sandboxId as string)?.trim();
      if (sandboxIdAbort) {
        const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxIdAbort));
        if (rows.length === 0) return { error: "Sandbox not found" };
        const sb = fromSandboxRow(rows[0]);
        if (!sb.containerId) return { error: "Sandbox has no container" };
        if (!sb.image?.toLowerCase().includes("openclaw"))
          return { error: "Sandbox is not an OpenClaw container" };
        const podman = getContainerManager();
        const runId = typeof a.runId === "string" ? a.runId.trim() : undefined;
        const { error } = await runOpenclawRpcInContainer(
          sb.containerId,
          "chat.abort",
          { sessionKey: "default", ...(runId ? { runId } : {}) },
          (cid, cmd) => podman.exec(cid, cmd)
        );
        if (error) return { error: `OpenClaw: ${error}`, message: "Could not abort." };
        return { message: "OpenClaw run aborted." };
      }
      const gatewayUrl =
        typeof a.gatewayUrl === "string" ? (a.gatewayUrl as string).trim() : undefined;
      let url = gatewayUrl;
      let token: string | undefined;
      if (vaultKey) {
        const vaultUrl = await getStoredCredential("openclaw_gateway_url", vaultKey);
        const vaultToken = await getStoredCredential("openclaw_gateway_token", vaultKey);
        if (!url && vaultUrl) url = vaultUrl;
        if (vaultToken) token = vaultToken;
      }
      try {
        const result = await openclawAbort({ url, token });
        return result.ok
          ? { message: "OpenClaw run aborted." }
          : { error: result.error, message: "Could not abort." };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}` };
      }
    }
    case "create_reminder": {
      const msg = typeof a.message === "string" ? (a.message as string).trim() : "";
      if (!msg) return { error: "message is required" };
      const asTask = a.taskType === "assistant_task";
      if (asTask && !conversationId)
        return { error: "Cannot schedule an assistant task without a conversation (use in chat)." };
      let runAt: number;
      if (typeof a.at === "string" && (a.at as string).trim()) {
        const t = Date.parse((a.at as string).trim());
        if (Number.isNaN(t)) return { error: "at must be a valid ISO 8601 date string" };
        runAt = t;
      } else if (typeof a.inMinutes === "number" && (a.inMinutes as number) > 0) {
        runAt = Date.now() + Math.min(a.inMinutes as number, 60 * 24 * 365) * 60 * 1000;
      } else {
        return { error: "Either at (ISO date) or inMinutes (number) is required" };
      }
      if (runAt <= Date.now()) return { error: "Reminder time must be in the future" };
      const id = crypto.randomUUID();
      const taskType = asTask ? ("assistant_task" as const) : ("message" as const);
      const reminder = {
        id,
        runAt,
        message: msg,
        conversationId: conversationId ?? null,
        taskType,
        status: "pending" as const,
        createdAt: Date.now(),
        firedAt: null,
      };
      await db.insert(reminders).values(toReminderRow(reminder)).run();
      scheduleReminder(id);
      return {
        id,
        runAt,
        reminderMessage: msg,
        taskType,
        status: "pending",
        createdAt: reminder.createdAt,
        message: asTask
          ? "Scheduled task set. The assistant will run this in the chat when it's time."
          : "Reminder set. You'll see it in this chat when it fires.",
      };
    }
    case "list_reminders": {
      const status = (a.status === "fired" || a.status === "cancelled" ? a.status : "pending") as
        | "pending"
        | "fired"
        | "cancelled";
      const rows = await db
        .select()
        .from(reminders)
        .where(eq(reminders.status, status))
        .orderBy(desc(reminders.runAt));
      return { reminders: rows.map(fromReminderRow), message: `${rows.length} reminder(s).` };
    }
    case "cancel_reminder": {
      const rid = typeof a.id === "string" ? (a.id as string).trim() : "";
      if (!rid) return { error: "id is required" };
      const rRows = await db.select().from(reminders).where(eq(reminders.id, rid));
      if (rRows.length === 0) return { error: "Reminder not found" };
      if (rRows[0].status !== "pending")
        return { error: "Reminder is not pending (already fired or cancelled)" };
      await db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, rid)).run();
      cancelReminderTimeout(rid);
      return { message: "Reminder cancelled." };
    }
    default:
      return undefined;
  }
}
