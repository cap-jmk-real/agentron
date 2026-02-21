/**
 * One-time script: extract handler block from execute-tool.ts and replace with dispatch.
 * Output file: execute-tool-handlers-workflows-runs-reminders.ts (descriptive name).
 * Run from repo root: node scripts/split-execute-tool.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const filePath = path.join(repoRoot, "packages/ui/app/api/chat/_lib/execute-tool.ts");

let content = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");

const startMarker = '    case "delete_workflow": {';
const endMarker = "\n  }\n  } catch (err)";
const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) {
  console.error("Could not find block boundaries", { startIdx, endIdx });
  process.exit(1);
}
const blockEnd = endIdx + "\n  }".length; // include switch-closing "  }" in block
const block = content.slice(startIdx, blockEnd);

const dispatch = `    let result = await executeToolPart2b(name, a, ctx);
    if (result !== undefined) return result;
    return { error: \`Unknown tool: \${name}\` };
  }`;

content = content.slice(0, startIdx) + dispatch + content.slice(blockEnd);

// Add import for executeToolPart2b
const importRunWorkflow =
  'import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE, WaitingForUserError } from "../../_lib/run-workflow";';
if (!content.includes("executeToolPart2b")) {
  content = content.replace(
    importRunWorkflow,
    importRunWorkflow + '\nimport { executeToolPart2b } from "./execute-tool-part2b";'
  );
}

fs.writeFileSync(filePath, content);
console.log("Replaced block in execute-tool.ts; length removed:", block.length);

// Write part2b file
const part2bPath = path.join(repoRoot, "packages/ui/app/api/chat/_lib/execute-tool-part2b.ts");
const part2bContent = `/**
 * Second part of execute-tool switch: delete_workflow through cancel_reminder.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { resolveWorkflowIdFromArgs } from "./execute-tool-shared";
import {
  db,
  workflows,
  workflowVersions,
  executions,
  agents,
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
} from "../../_lib/db";
import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE, WaitingForUserError } from "../../_lib/run-workflow";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { enqueueWorkflowResume } from "../../_lib/workflow-queue";
import { getContainerManager, withContainerInstallHint } from "../../_lib/container-manager";
import { getStoredCredential } from "../../_lib/credential-store";
import { createRunNotification } from "../../_lib/notifications-store";
import { scheduleReminder, cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { runShellCommand } from "../../_lib/shell-exec";
import { openclawSend, openclawHistory, openclawAbort } from "../../_lib/openclaw-client";
import { testRemoteConnection } from "../../_lib/remote-test";
import { getShellCommandAllowlist, updateAppSettings } from "../../_lib/app-settings";
import { ensureRunnerSandboxId } from "./execute-tool-shared";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { searchWeb, fetchUrl, refinePrompt } from "@agentron-studio/runtime";

export async function executeToolPart2b(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined
): Promise<unknown | undefined> {
  const conversationId = ctx?.conversationId;
  const vaultKey = ctx?.vaultKey ?? null;

  switch (name) {
${block.replace("      return { error: `Unknown tool: ${name}` };", "      return undefined;")}
  }
}
`;

fs.writeFileSync(part2bPath, part2bContent);
console.log("Wrote execute-tool-part2b.ts");
