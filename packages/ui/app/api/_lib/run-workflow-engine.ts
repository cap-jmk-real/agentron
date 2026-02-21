/**
 * Workflow execution engine: runs a workflow graph and returns output/trail.
 * Extracted from run-workflow.ts to keep it under 1000 lines.
 */
import { eq } from "drizzle-orm";
import {
  WorkflowEngine,
  SharedContextManager,
  NodeAgentExecutor,
  CodeAgentExecutor,
  createDefaultLLMManager,
  resolveModelPricing,
  calculateCost,
} from "@agentron-studio/runtime";
import type { Workflow, Agent, LLMConfig, Canvas } from "@agentron-studio/core";
import type { PromptTemplate } from "@agentron-studio/core";
import type { LLMResponse } from "@agentron-studio/runtime";
import {
  enqueueExecutionEvent,
  getNextPendingEvent,
  markEventProcessed,
  getExecutionRunState,
  setExecutionRunState,
  updateExecutionRunState,
  parseRunStateSharedContext,
} from "./execution-events";
import { appendExecutionLogStep } from "./execution-log";
import {
  db,
  agents,
  workflows,
  tools as toolsTable,
  llmConfigs,
  tokenUsage,
  modelPricing,
  executions,
  runLogs,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
  fromLlmConfigRowWithSecret,
  fromModelPricingRow,
  toTokenUsageRow,
  ensureStandardTools,
  insertWorkflowMessage,
  getWorkflowMessages,
} from "./db";
import { createRunNotification } from "./notifications-store";
import {
  runContainer,
  runContainerSession,
  runWriteFile,
  type ContainerStreamChunk,
} from "./run-workflow-containers";
import {
  WAITING_FOR_USER_MESSAGE,
  RUN_CANCELLED_MESSAGE,
  WaitingForUserError,
  isToolResultFailure,
  type ExecutionTraceStep,
} from "./run-workflow-constants";
import {
  buildWorkflowMemoryBlock,
  buildAvailableTools,
  executeStudioTool,
  getLogSourceTag,
  GET_WORKFLOW_CONTEXT_TOOL_ID,
  FIRST_TURN_DEFAULT,
  STD_IDS,
  WORKFLOW_MEMORY_MAX_RECENT_TURNS,
  type ToolOverride,
} from "./run-workflow-tool-execution";

export type RunWorkflowOptions = {
  workflowId: string;
  runId: string;
  branchId?: string;
  resumeUserResponse?: string;
  vaultKey?: Buffer | null;
  onStepComplete?: (trail: ExecutionTraceStep[], lastOutput: unknown) => void | Promise<void>;
  onProgress?: (
    state: { message: string; toolId?: string },
    currentTrail: ExecutionTraceStep[]
  ) => void | Promise<void>;
  isCancelled?: () => Promise<boolean>;
  onContainerStream?: (runId: string, chunk: ContainerStreamChunk) => void;
  maxSelfFixRetries?: number;
};

export async function runWorkflow(options: RunWorkflowOptions): Promise<{
  output: unknown;
  context: Record<string, unknown>;
  trail: ExecutionTraceStep[];
}> {
  const { workflowId, runId, branchId, maxSelfFixRetries: maxSelfFixRetriesOption = 0 } = options;
  const trail: ExecutionTraceStep[] = [];
  let stepOrder = 0;

  const wfRows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (wfRows.length === 0) throw new Error("Workflow not found");
  const workflow = fromWorkflowRow(wfRows[0]) as Workflow;

  // Resolve graph: when branchId is set and workflow has that branch, run the branch's graph; else run main graph.
  const branch =
    branchId && Array.isArray(workflow.branches)
      ? workflow.branches.find((b) => b.id === branchId)
      : undefined;
  const effectiveNodes = branch ? (branch.nodes ?? []) : (workflow.nodes ?? []);
  const effectiveEdges = branch ? (branch.edges ?? []) : (workflow.edges ?? []);
  const effectiveMaxRounds = branch
    ? (branch.maxRounds ?? undefined)
    : (workflow.maxRounds ?? undefined);
  const effectiveTurnInstruction = branch
    ? (branch.turnInstruction ?? workflow.turnInstruction)
    : workflow.turnInstruction;
  const workflowForEngine: Workflow = {
    ...workflow,
    nodes: effectiveNodes,
    edges: effectiveEdges,
    maxRounds: effectiveMaxRounds,
    turnInstruction: effectiveTurnInstruction ?? undefined,
  };

  const configRows = await db.select().from(llmConfigs);
  if (configRows.length === 0) throw new Error("No LLM provider configured");
  const configsWithSecret = configRows.map(fromLlmConfigRowWithSecret);
  const llmConfig =
    configsWithSecret.find(
      (c) =>
        (typeof (c as { extra?: { apiKey?: string } }).extra?.apiKey === "string" &&
          (c as { extra?: { apiKey?: string } }).extra!.apiKey!.length > 0) ||
        (typeof (c as { apiKeyRef?: string }).apiKeyRef === "string" &&
          (c as { apiKeyRef?: string }).apiKeyRef!.length > 0)
    ) ?? configsWithSecret[0];

  const pricingRows = await db.select().from(modelPricing);
  const customPricing: Record<string, { input: number; output: number }> = {};
  for (const r of pricingRows) {
    const p = fromModelPricingRow(r);
    customPricing[p.modelPattern] = {
      input: Number(p.inputCostPerM),
      output: Number(p.outputCostPerM),
    };
  }

  const manager = createDefaultLLMManager(async (ref) => (ref ? process.env[ref] : undefined));

  const resolveLlmConfig = (id?: string) => {
    if (!id) return llmConfig;
    const c = configsWithSecret.find((x) => (x as { id?: string }).id === id);
    return c ? (c as { id: string; provider: string; model: string }) : llmConfig;
  };

  let currentAgentId: string | undefined;
  const usageEntries: {
    response: LLMResponse;
    agentId?: string;
    config: { provider: string; model: string };
  }[] = [];
  const trackingCallLLM = async (
    req: Parameters<typeof manager.chat>[1] & { llmConfigId?: string }
  ) => {
    const cfg = resolveLlmConfig(req.llmConfigId);
    const { llmConfigId: _drop, ...chatReq } = req as Record<string, unknown>;
    const response = await manager.chat(
      cfg as LLMConfig,
      chatReq as Parameters<typeof manager.chat>[1],
      { source: "workflow" }
    );
    usageEntries.push({
      response,
      agentId: currentAgentId,
      config: { provider: cfg.provider, model: cfg.model },
    });
    return response;
  };

  // Normalize edges: canvas uses source/target, engine/handler use from/to; preserve condition for conditional edges
  const edges = (workflowForEngine.edges ?? []).map(
    (e: {
      source?: string;
      target?: string;
      from?: string;
      to?: string;
      condition?: { type: string; value: string };
    }) => ({
      from: e.source ?? e.from ?? "",
      to: e.target ?? e.to ?? "",
      condition: e.condition,
    })
  );

  /** Evaluate edge condition against last output/message (for conditional edges). */
  function evaluateEdgeCondition(
    condition: { type: string; value: string } | undefined,
    lastOutput: unknown
  ): boolean {
    if (!condition) return true;
    const content = typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput ?? "");
    if (condition.type === "message_type") {
      return (
        content === condition.value ||
        (lastOutput != null &&
          typeof lastOutput === "object" &&
          (lastOutput as Record<string, unknown>).type === condition.value)
      );
    }
    if (condition.type === "content_contains") {
      return content.toLowerCase().includes(condition.value.toLowerCase());
    }
    return true;
  }

  /** Compute next node from workflow graph (with conditional edges and rounds). */
  function computeNextNodeId(
    currentNodeId: string,
    lastOutput: unknown,
    round: number
  ): { nextNodeId: string | null; nextRound: number; completed: boolean } {
    const nodes = workflowForEngine.nodes ?? [];
    const maxRounds =
      effectiveMaxRounds != null && effectiveMaxRounds > 0 ? effectiveMaxRounds : null;
    const startNodeId = nodes[0]?.id ?? null;
    const hasEdges = edges.length > 0;

    if (hasEdges && startNodeId) {
      const outgoing = edges.filter((e: { from: string }) => e.from === currentNodeId);
      const matching = outgoing.filter((e: { condition?: { type: string; value: string } }) =>
        evaluateEdgeCondition(e.condition, lastOutput)
      );
      const edge = matching[0] ?? outgoing[0];
      const nextId = edge?.to ?? null;
      if (nextId && nextId !== startNodeId)
        return { nextNodeId: nextId, nextRound: round, completed: false };
      if (nextId === startNodeId) {
        const nextRound = round + 1;
        if (maxRounds != null && nextRound >= maxRounds)
          return { nextNodeId: null, nextRound, completed: true };
        return { nextNodeId: startNodeId, nextRound, completed: false };
      }
      return { nextNodeId: null, nextRound: round, completed: true };
    }

    const idx = nodes.findIndex((n) => n.id === currentNodeId);
    if (idx < 0 || idx >= nodes.length - 1)
      return { nextNodeId: null, nextRound: round, completed: true };
    return { nextNodeId: nodes[idx + 1].id, nextRound: round, completed: false };
  }

  const USE_EVENT_DRIVEN_ENGINE = true;

  async function buildToolInstructionsBlock(toolIds: string[]): Promise<string> {
    if (toolIds.length === 0) return "";
    const lines: string[] = [];
    const maxLen = 600;
    for (const id of toolIds) {
      if (STD_IDS[id]) continue;
      const rows = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
      if (rows.length === 0) continue;
      const tool = fromToolRow(rows[0]);
      const cfg = tool.config as { systemPrompt?: string; instructions?: string } | undefined;
      const text = (cfg?.systemPrompt ?? cfg?.instructions ?? "").trim();
      if (text) lines.push(`Tool ${tool.name}: ${text}`);
    }
    const block = lines.join("\n");
    return block.length > maxLen ? block.slice(0, maxLen) + "…" : block;
  }

  const agentHandler = async (
    nodeId: string,
    config: Record<string, unknown> | undefined,
    sharedContext: {
      get: (k: string) => unknown;
      set: (k: string, v: unknown) => void;
      snapshot?: () => Record<string, unknown>;
    }
  ): Promise<unknown> => {
    if (options.isCancelled && (await options.isCancelled())) {
      throw new Error(RUN_CANCELLED_MESSAGE);
    }
    let agentId = config?.agentId as string | undefined;
    if (!agentId && config?.agentName != null) {
      const byName = await db
        .select()
        .from(agents)
        .where(eq(agents.name, String(config.agentName)));
      if (byName.length > 0) agentId = byName[0].id;
    }
    if (!agentId) throw new Error(`Workflow node ${nodeId}: missing agentId in config`);

    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId));
    if (agentRows.length === 0) throw new Error(`Agent not found: ${agentId}`);
    const agent = fromAgentRow(agentRows[0]) as Agent;
    const agentDef = (agent as Agent & { definition?: { toolIds?: string[] } }).definition ?? {};
    const agentToolIds = (agentDef.toolIds ?? []) as string[];

    const incoming = edges.filter((e) => e.to === nodeId);
    const fromId = incoming[0]?.from;
    let partnerOutput: unknown = fromId ? sharedContext.get(`__output_${fromId}`) : undefined;
    let sourceNodeId: string | undefined = fromId;
    if (partnerOutput === undefined && !fromId) {
      const prevNodeIndex = (workflowForEngine.nodes ?? []).findIndex((n) => n.id === nodeId) - 1;
      const prevNode =
        prevNodeIndex >= 0 ? (workflowForEngine.nodes ?? [])[prevNodeIndex] : undefined;
      partnerOutput = prevNode ? sharedContext.get(`__output_${prevNode.id}`) : undefined;
      sourceNodeId = prevNode?.id;
    }
    // Prefer partner message from persisted workflow_messages when available (message-based communication)
    const runMsgs = await getWorkflowMessages(runId, 500);
    if (runMsgs.length > 0 && fromId) {
      const lastFromNode = [...runMsgs]
        .reverse()
        .find((m) => m.nodeId === fromId && m.role === "agent");
      if (lastFromNode) partnerOutput = lastFromNode.content;
    }
    const resumeText = options.resumeUserResponse?.trim() ?? "";
    const looksLikeVaultApproval =
      /use vault|vault credentials|yes.*vault|approve.*vault/i.test(resumeText) &&
      resumeText.length < 120;
    let partnerMessage =
      partnerOutput !== undefined
        ? typeof partnerOutput === "string"
          ? partnerOutput
          : JSON.stringify(partnerOutput)
        : resumeText !== ""
          ? looksLikeVaultApproval
            ? `The user has replied: "${resumeText}". They approved using vault credentials. Call std-list-vault-credentials to see which keys are stored, then std-get-vault-credential with the key that matches each field (username/email vs password). Use each returned .value in std-browser-automation fill. Do not ask the user to paste credentials. Do not call request_user_help again for the same question.`
            : `The user has replied to your previous request (the one you sent via request_user_help). Their reply: "${resumeText}". Proceed based on this reply; do not call request_user_help again for the same question.`
          : FIRST_TURN_DEFAULT;
    if (
      partnerMessage === FIRST_TURN_DEFAULT &&
      config &&
      (config.savedSearchUrl != null || config.autoUseVault != null)
    ) {
      const parts: string[] = [FIRST_TURN_DEFAULT];
      if (config.savedSearchUrl != null && String(config.savedSearchUrl).trim()) {
        parts.push(
          `Use the following saved search URL (provided by the workflow; do not call request_user_help to ask for the URL): ${String(config.savedSearchUrl).trim()}`
        );
      }
      if (config.autoUseVault === true || config.autoUseVault === "true") {
        parts.push("Use vault credentials when needed (autoUseVault is enabled).");
      }
      partnerMessage = parts.join("\n\n");
    }
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "run-workflow.ts:partnerMessage",
        message: "agent step partnerMessage",
        data: {
          fromResume: partnerOutput === undefined && (options.resumeUserResponse?.length ?? 0) > 0,
          partnerMessageLen: typeof partnerMessage === "string" ? partnerMessage.length : 0,
        },
        hypothesisId: "H4_H5",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const precedingAgentName = sourceNodeId
      ? (sharedContext.get(`__agentName_${sourceNodeId}`) as string | undefined)
      : undefined;

    const recentTurns =
      (sharedContext.get("__recent_turns") as
        | Array<{ speaker: string; text: string }>
        | undefined) ?? [];
    const summary = (sharedContext.get("__summary") as string | undefined) ?? "";
    let input = buildWorkflowMemoryBlock({
      turnInstruction: effectiveTurnInstruction ?? undefined,
      summary,
      recentTurns,
      partnerMessage,
      precedingAgentName:
        precedingAgentName && String(precedingAgentName).trim() ? precedingAgentName : undefined,
    });
    currentAgentId = agentId;

    const round = sharedContext.get("__round") as number | undefined;
    const inputIsUserReply =
      partnerOutput === undefined && (options.resumeUserResponse?.length ?? 0) > 0;
    const step: ExecutionTraceStep = {
      nodeId,
      agentId,
      agentName: agent.name,
      order: stepOrder++,
      ...(round !== undefined && { round }),
      input,
      ...(inputIsUserReply && { inputIsUserReply: true }),
    };
    const toolCallsForStep: Array<{ name: string; argsSummary?: string; resultSummary?: string }> =
      [];
    let lastToolId: string | null = null;
    let lastToolResult: unknown = null;
    let selfFixAttempts = 0;
    const maxSelfFixRetries = Math.max(0, Math.min(10, maxSelfFixRetriesOption));

    function toolArgsSummary(toolId: string, args: unknown): string | undefined {
      if (args == null || typeof args !== "object") return undefined;
      const o = args as Record<string, unknown>;
      if (toolId === "std-container-run") {
        const image = typeof o.image === "string" ? o.image : undefined;
        const cmd = o.command != null ? String(o.command).slice(0, 80) : undefined;
        if (image || cmd)
          return [image && `image: ${image}`, cmd && `command: ${cmd}`].filter(Boolean).join(", ");
        return undefined;
      }
      if (toolId === "std-container-session") {
        const act = typeof o.action === "string" ? o.action : undefined;
        const image = typeof o.image === "string" ? o.image : undefined;
        const cmd = o.command != null ? String(o.command).slice(0, 80) : undefined;
        if (act)
          return [act, image && `image: ${image}`, cmd && `command: ${cmd}`]
            .filter(Boolean)
            .join(", ");
        return undefined;
      }
      if (toolId === "std-container-build") {
        const ctx = typeof o.contextPath === "string" ? o.contextPath : undefined;
        const df = typeof o.dockerfilePath === "string" ? o.dockerfilePath : undefined;
        const tag = typeof o.imageTag === "string" ? o.imageTag : undefined;
        if (tag)
          return [ctx && `context: ${ctx}`, df && `file: ${df}`, `tag: ${tag}`]
            .filter(Boolean)
            .join(", ");
        return undefined;
      }
      if (toolId === "std-write-file") {
        const name = typeof o.name === "string" ? o.name : undefined;
        const len = typeof o.content === "string" ? o.content.length : 0;
        if (name) return `name: ${name}${len ? `, ${len} chars` : ""}`;
        return undefined;
      }
      if (toolId === "std-browser-automation") {
        const act = typeof o.action === "string" ? o.action : undefined;
        const url = typeof o.url === "string" ? o.url : undefined;
        const sel = typeof o.selector === "string" ? o.selector : undefined;
        if (act)
          return [act, url && `url: ${url.slice(0, 40)}`, sel && `selector: ${sel.slice(0, 30)}`]
            .filter(Boolean)
            .join(", ");
        return undefined;
      }
      if (toolId === "request_user_help") {
        const q =
          typeof o.question === "string"
            ? o.question
            : typeof o.message === "string"
              ? o.message
              : undefined;
        const opts = Array.isArray(o.options)
          ? o.options
          : Array.isArray(o.suggestions)
            ? o.suggestions
            : [];
        const optsPart = opts.length > 0 ? `, ${opts.length} option(s)` : "";
        return q ? `question: ${q}${optsPart}` : undefined;
      }
      if (toolId === "std-get-vault-credential") {
        const key = typeof o.credentialKey === "string" ? o.credentialKey : undefined;
        return key ? `credentialKey: ${key}` : undefined;
      }
      if (toolId === "std-list-vault-credentials") return "list keys";
      return undefined;
    }

    const workflowContextSnapshot =
      typeof sharedContext.snapshot === "function" ? sharedContext.snapshot() : {};
    const shared = { ...workflowContextSnapshot } as Record<string, unknown>;

    const def =
      (
        agent as Agent & {
          definition?: {
            graph?: { nodes?: unknown[] };
            toolIds?: string[];
            defaultLlmConfigId?: string;
          };
        }
      ).definition ?? {};
    const declaredToolIds = (def.toolIds ?? []) as string[];
    const graphNodes =
      def.graph && typeof def.graph === "object" && Array.isArray(def.graph.nodes)
        ? def.graph.nodes
        : [];
    const graphToolIds = graphNodes
      .filter(
        (n): n is { type?: string; parameters?: { toolId?: string } } =>
          typeof n === "object" && n !== null && (n as { type?: string }).type === "tool"
      )
      .map((n) => (n.parameters?.toolId as string)?.trim())
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const toolIds = [...new Set([...declaredToolIds, ...graphToolIds])];
    const defaultLlmConfigId = def.defaultLlmConfigId as string | undefined;
    let availableTools = await buildAvailableTools(toolIds);
    const requestUserHelpTool = {
      type: "function" as const,
      function: {
        name: "request_user_help",
        description:
          "Pause the run so the user can provide input. The run stops until the user responds in Chat or the run page. You MUST pass a concrete, actionable question — never use generic text like 'Please confirm', 'How can I help?', or 'Need your input'. Follow the agent's system prompt: if it defines a template (e.g. 'Which saved searches should I analyze?' with a numbered list), use that template and substitute the actual data (e.g. the list you retrieved). Set 'question' to the full text shown to the user (include any list, instructions, and example reply format). Use 'options' or 'suggestions' for clickable choices (e.g. ['Yes', 'No'] or ['Analyze all', 'Select saved searches', 'Cancel']). If the result contains _selfFixContinue, retry the failed tool and do not call request_user_help again for that retry.",
        parameters: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              enum: ["credentials", "two_fa", "confirmation", "choice", "other"],
              description: "Kind of help needed",
            },
            message: {
              type: "string",
              description:
                "Short internal label for what you need (e.g. 'Vault login for LinkedIn'). Shown as fallback if question is empty.",
            },
            question: {
              type: "string",
              description:
                "REQUIRED: Full question/text shown to the user. Must be concrete and actionable (e.g. include a numbered list of items, how to reply, example format). Do not use generic phrases like 'Please confirm'.",
            },
            suggestions: {
              type: "array",
              items: { type: "string" },
              description:
                "Choice strings shown as buttons (e.g. ['Yes', 'No'] or ['1,3', 'Analyze all', 'Cancel']).",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Same as suggestions: choice strings for the UI.",
            },
          },
          required: ["message"] as string[],
        },
      },
    };
    availableTools = [
      ...availableTools,
      {
        type: "function" as const,
        function: {
          name: GET_WORKFLOW_CONTEXT_TOOL_ID,
          description:
            "Get current workflow context: summary, recent conversation turns, and round index. Call this when you need to see the full conversation so far.",
          parameters: { type: "object" as const, properties: {}, required: [] as string[] },
        },
      },
      ...(toolIds.includes("std-request-user-help") ? [requestUserHelpTool] : []),
    ];

    let toolInstructionsBlock = await buildToolInstructionsBlock(toolIds);
    if (toolIds.includes("std-request-user-help")) {
      const requestUserHelpNote =
        "When calling request_user_help you must set 'question' to a concrete, actionable message (e.g. include a numbered list of items and how to reply). Do not use generic text like 'Please confirm' or 'How can I help?'.";
      toolInstructionsBlock = toolInstructionsBlock
        ? `${toolInstructionsBlock}\n${requestUserHelpNote}`
        : requestUserHelpNote;
    }
    if (toolIds.includes("std-browser-automation") && toolIds.includes("std-web-search")) {
      const urlSearchNote =
        "If a URL does not load or is wrong (e.g. 404, timeout, unreachable), use web search to find the correct URL, then retry browser navigate.";
      toolInstructionsBlock = toolInstructionsBlock
        ? `${toolInstructionsBlock}\n${urlSearchNote}`
        : urlSearchNote;
    }
    if (
      (toolIds.includes("std-get-vault-credential") ||
        toolIds.includes("std-list-vault-credentials")) &&
      toolIds.includes("std-browser-automation")
    ) {
      const vaultFillNote =
        "For login forms: call std-list-vault-credentials first to see which credential keys are stored (e.g. linkedin_username, linkedin_password). Then call std-get-vault-credential with the exact key that matches the field (username/email vs password). Use the returned .value in std-browser-automation fill. Never type placeholders. If you don't have std-list-vault-credentials, try keys like linkedin_email and linkedin_password.";
      toolInstructionsBlock = toolInstructionsBlock
        ? `${toolInstructionsBlock}\n${vaultFillNote}`
        : vaultFillNote;
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "run-workflow.ts:vaultFillNote",
          message: "vault fill note injected",
          data: {
            runId,
            toolIds: toolIds.filter((t) => t.includes("vault") || t.includes("browser")),
            noteLen: vaultFillNote.length,
          },
          hypothesisId: "H1",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    }

    const context = {
      sharedContext: shared,
      availableTools,
      buildToolsForIds: async (ids: string[]) => {
        const base = await buildAvailableTools(ids);
        return [
          ...base,
          {
            type: "function" as const,
            function: {
              name: GET_WORKFLOW_CONTEXT_TOOL_ID,
              description:
                "Get current workflow context: summary, recent conversation turns, and round index.",
              parameters: { type: "object" as const, properties: {}, required: [] as string[] },
            },
          },
        ];
      },
      ragBlock: "",
      toolInstructionsBlock: toolInstructionsBlock
        ? `Tool instructions:\n${toolInstructionsBlock}`
        : "",
      callLLM: async (input: unknown) => {
        const req =
          input && typeof input === "object" && "messages" in (input as object)
            ? (input as { llmConfigId?: string; messages: unknown[]; tools?: unknown[] })
            : { messages: [{ role: "user" as const, content: String(input ?? "") }] };
        await appendExecutionLogStep(runId, "llm_request", "Calling LLM…", {
          messages: req.messages,
        });
        const res = await trackingCallLLM(req as Parameters<typeof trackingCallLLM>[0]);
        await appendExecutionLogStep(runId, "llm_response", "Response", {
          content: typeof res.content === "string" ? res.content : undefined,
          usage: res.usage,
        });
        return req.tools && Array.isArray(req.tools) && req.tools.length > 0 ? res : res.content;
      },
      callTool: async (toolId: string, input: unknown, override?: ToolOverride) => {
        if (toolId === GET_WORKFLOW_CONTEXT_TOOL_ID) {
          return {
            summary: sharedContext.get("__summary"),
            recentTurns: sharedContext.get("__recent_turns"),
            round: sharedContext.get("__round"),
          };
        }
        toolCallsForStep.push({ name: toolId, argsSummary: toolArgsSummary(toolId, input) });
        await appendExecutionLogStep(runId, "tool_call", toolId, { toolId, input });
        // Emit progress so the run page shows "Executing: <toolId>" while waiting (avoids appearing stuck)
        await options.onProgress?.({ message: `Executing: ${toolId}`, toolId }, trail);
        if (toolId === "request_user_help") {
          const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
          const message =
            (typeof arg.message === "string" ? arg.message : "").trim() || "Need your input";
          const question = (typeof arg.question === "string" ? arg.question : "").trim() || message;
          const type = typeof arg.type === "string" ? arg.type : "other";
          const rawSuggestions = arg.suggestions;
          const rawOptions = arg.options;
          const suggestionsList = Array.isArray(rawSuggestions)
            ? rawSuggestions.filter((s): s is string => typeof s === "string").slice(0, 50)
            : [];
          const optionsList = Array.isArray(rawOptions)
            ? rawOptions.filter((s): s is string => typeof s === "string").slice(0, 50)
            : [];
          const combined = optionsList.length > 0 ? optionsList : suggestionsList;
          const lastToolFailed = lastToolId != null && isToolResultFailure(lastToolResult);
          const isRetryConfirmation = type === "confirmation" || type === "other";
          if (lastToolFailed && selfFixAttempts < maxSelfFixRetries && isRetryConfirmation) {
            selfFixAttempts += 1;
            return {
              _selfFixContinue: true,
              instruction:
                "The last tool call failed. Proceed with your suggested fix: retry the tool with corrected arguments or use another tool as needed. Do not call request_user_help again for this retry.",
            };
          }
          const payload: Record<string, unknown> = { question, type, message, reason: message };
          if (combined.length > 0) {
            payload.suggestions = combined;
            payload.options = combined;
          }
          // Preserve execution trail so the run page shows steps and continuation after user reply
          const runRows = await db
            .select({ output: executions.output })
            .from(executions)
            .where(eq(executions.id, runId));
          const existingParsed =
            runRows[0]?.output != null
              ? typeof runRows[0].output === "string"
                ? (() => {
                    try {
                      return JSON.parse(runRows[0].output as string) as Record<string, unknown>;
                    } catch {
                      return {};
                    }
                  })()
                : (runRows[0].output as Record<string, unknown>)
              : {};
          const existingTrailBefore = Array.isArray(existingParsed.trail)
            ? (existingParsed.trail as ExecutionTraceStep[])
            : [];
          step.output = undefined;
          if (toolCallsForStep.length > 0) step.toolCalls = [...toolCallsForStep];
          const trailWithCurrent = [...existingTrailBefore, step];
          payload.trail = trailWithCurrent;
          if (toolCallsForStep.length > 0) {
            const last = toolCallsForStep[toolCallsForStep.length - 1];
            last.resultSummary = "waiting for user";
          }
          // #region agent log
          fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location: "run-workflow.ts:request_user_help",
              message: "writing waiting_for_user payload",
              data: { runId, questionLen: question?.length ?? 0, optionsLen: combined.length },
              hypothesisId: "H5",
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          await db
            .update(executions)
            .set({
              status: "waiting_for_user",
              output: JSON.stringify(payload),
            })
            .where(eq(executions.id, runId))
            .run();
          try {
            await createRunNotification(runId, "waiting_for_user", {
              targetType: "workflow",
              targetId: workflowId,
            });
          } catch {
            // ignore
          }
          await appendExecutionLogStep(runId, "tool_result", toolId, {
            toolId,
            waitingForUser: true,
          });
          throw new Error(WAITING_FOR_USER_MESSAGE);
        }
        const toolContext = {
          summary: sharedContext.get("__summary"),
          recentTurns: sharedContext.get("__recent_turns"),
          round: sharedContext.get("__round"),
        };
        const merged =
          input !== null && typeof input === "object"
            ? { ...(input as Record<string, unknown>), _workflowContext: toolContext }
            : { _workflowContext: toolContext, message: input };
        let result: unknown;
        if (toolId === "std-container-session") {
          const onChunk = options.onContainerStream
            ? (chunk: ContainerStreamChunk) => options.onContainerStream!(runId, chunk)
            : undefined;
          result = await runContainerSession(runId, merged, onChunk);
        } else if (toolId === "std-container-run" && options.onContainerStream) {
          result = await runContainer(merged, (chunk) => options.onContainerStream!(runId, chunk));
        } else if (toolId === "std-write-file") {
          result = await runWriteFile(merged, runId);
        } else {
          if (toolId === "std-browser-automation") {
            const arg =
              merged && typeof merged === "object" ? (merged as Record<string, unknown>) : {};
            const action = typeof arg.action === "string" ? arg.action : "";
            const url = typeof arg.url === "string" ? String(arg.url).trim() : "";
            const selector = typeof arg.selector === "string" ? String(arg.selector).trim() : "";
            const valueLen = typeof arg.value === "string" ? (arg.value as string).length : 0;
            const parts: string[] = [action || "?"];
            if (url) parts.push(`url=${url.length > 100 ? url.slice(0, 97) + "…" : url}`);
            if (selector)
              parts.push(
                `selector=${selector.length > 80 ? selector.slice(0, 77) + "…" : selector}`
              );
            if (action === "fill" && valueLen > 0) parts.push(`valueLen=${valueLen}`);
            await db
              .insert(runLogs)
              .values({
                id: crypto.randomUUID(),
                executionId: runId,
                level: "stdout",
                message: `[Playwright] ${parts.join(" ")}`,
                payload: JSON.stringify({
                  source: "playwright",
                  action: action || "?",
                  url: url || undefined,
                }),
                createdAt: Date.now(),
              })
              .run();
          }
          try {
            result = await executeStudioTool(
              toolId,
              merged,
              override,
              options.vaultKey ?? null,
              options.isCancelled,
              runId
            );
          } catch (toolErr) {
            const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            const arg =
              merged && typeof merged === "object" ? (merged as Record<string, unknown>) : {};
            const sourceTag = getLogSourceTag(toolId);
            const payloadObj: Record<string, unknown> = {
              source: sourceTag
                .replace(/^\[|\]$/g, "")
                .toLowerCase()
                .replace(" ", "_"),
              toolId,
              error: errMsg.slice(0, 500),
            };
            if (toolId === "std-web-search" && typeof arg.query === "string")
              payloadObj.query = arg.query.slice(0, 200);
            if (toolId === "std-browser-automation") {
              if (typeof arg.url === "string") payloadObj.url = arg.url.slice(0, 200);
              if (typeof arg.action === "string") payloadObj.action = arg.action;
            }
            if (toolId === "std-run-code") {
              if (typeof arg.language === "string") payloadObj.language = arg.language;
              if (typeof arg.code === "string") payloadObj.codeSnippet = arg.code.slice(0, 300);
            }
            await db
              .insert(runLogs)
              .values({
                id: crypto.randomUUID(),
                executionId: runId,
                level: "stderr",
                message: `${sourceTag} threw — ${errMsg}`,
                payload: JSON.stringify(payloadObj),
                createdAt: Date.now(),
              })
              .run();
            if (toolCallsForStep.length > 0) {
              const last = toolCallsForStep[toolCallsForStep.length - 1];
              last.resultSummary = (errMsg.split(/\n/)[0]?.trim() ?? errMsg).slice(0, 100);
            }
            await appendExecutionLogStep(runId, "tool_result", toolId, { toolId, error: errMsg });
            throw toolErr;
          }
        }
        const toolErrorMsg =
          result != null &&
          typeof result === "object" &&
          "error" in result &&
          typeof (result as { error: unknown }).error === "string"
            ? (result as { error: string }).error
            : result != null &&
                typeof result === "object" &&
                (result as { success?: boolean }).success === false &&
                "error" in result &&
                typeof (result as { error: unknown }).error === "string"
              ? (result as { error: string }).error
              : null;
        if (toolErrorMsg) {
          const sourceTag = getLogSourceTag(toolId);
          const arg =
            merged && typeof merged === "object" ? (merged as Record<string, unknown>) : {};
          const res =
            result != null && typeof result === "object" ? (result as Record<string, unknown>) : {};
          const payloadObj: Record<string, unknown> = {
            source: sourceTag
              .replace(/^\[|\]$/g, "")
              .toLowerCase()
              .replace(" ", "_"),
            toolId,
            error: toolErrorMsg.slice(0, 500),
          };
          if (toolId === "std-web-search" && typeof arg.query === "string")
            payloadObj.query = arg.query.slice(0, 200);
          if (toolId === "std-browser-automation") {
            if (typeof arg.url === "string") payloadObj.url = arg.url.slice(0, 200);
            if (typeof arg.action === "string") payloadObj.action = arg.action;
            if (typeof arg.selector === "string") payloadObj.selector = arg.selector.slice(0, 100);
          }
          if (toolId === "std-run-code") {
            if (typeof arg.language === "string") payloadObj.language = arg.language;
            if (typeof arg.code === "string") payloadObj.codeSnippet = arg.code.slice(0, 300);
            if (typeof res.stderr === "string") payloadObj.stderr = res.stderr.slice(0, 500);
            if (typeof res.stdout === "string" && res.stdout.length > 0)
              payloadObj.stdoutPreview = res.stdout.slice(0, 200);
          }
          await db
            .insert(runLogs)
            .values({
              id: crypto.randomUUID(),
              executionId: runId,
              level: "stderr",
              message: `${sourceTag} ${toolErrorMsg}`,
              payload: JSON.stringify(payloadObj),
              createdAt: Date.now(),
            })
            .run();
        }
        // Record short result for trail (so run page shows outcome per action; no secrets)
        if (toolCallsForStep.length > 0) {
          const last = toolCallsForStep[toolCallsForStep.length - 1];
          last.resultSummary = toolErrorMsg
            ? (toolErrorMsg.split(/\n/)[0]?.trim() ?? toolErrorMsg).slice(0, 100)
            : "ok";
        }
        // Persist container non-zero exit for any workflow run (streaming or one-shot)
        if (
          (toolId === "std-container-run" || toolId === "std-container-session") &&
          result != null &&
          typeof result === "object" &&
          "exitCode" in result
        ) {
          const r = result as { exitCode: number; stderr?: string };
          if (r.exitCode !== 0) {
            const stderrPreview = (r.stderr ?? "").trim().slice(0, 200);
            void db
              .insert(runLogs)
              .values({
                id: crypto.randomUUID(),
                executionId: runId,
                level: "stderr",
                message: `[Container] exited with code ${r.exitCode}${stderrPreview ? ` — ${stderrPreview}` : ""}`,
                payload: JSON.stringify({
                  source: "container",
                  toolId,
                  exitCode: r.exitCode,
                  stderrSummary: (r.stderr ?? "").slice(0, 500),
                }),
                createdAt: Date.now(),
              })
              .run();
          }
        }
        await appendExecutionLogStep(runId, "tool_result", toolId, { toolId, result });
        lastToolId = toolId;
        lastToolResult = result;
        return result;
      },
    };

    try {
      let output: unknown;
      if (agent.kind === "code") {
        const def =
          (agent as Agent & { definition?: { source?: string; entrypoint?: string } }).definition ??
          {};
        const executor = new CodeAgentExecutor();
        output = await executor.execute(
          { source: def.source ?? "", entrypoint: def.entrypoint ?? "default" },
          input,
          context
        );
      } else {
        const nodeDef =
          (
            agent as Agent & {
              definition?: { graph?: { nodes?: unknown[]; edges?: unknown[] }; toolIds?: string[] };
            }
          ).definition ?? {};
        const rawGraph = nodeDef.graph;
        const rawNodes =
          rawGraph &&
          typeof rawGraph === "object" &&
          !Array.isArray(rawGraph) &&
          Array.isArray((rawGraph as { nodes?: unknown[] }).nodes)
            ? (rawGraph as { nodes: unknown[] }).nodes
            : [];
        const rawEdges =
          rawGraph &&
          typeof rawGraph === "object" &&
          !Array.isArray(rawGraph) &&
          Array.isArray((rawGraph as { edges?: unknown[] }).edges)
            ? (rawGraph as { edges: unknown[] }).edges
            : [];
        const graph = {
          nodes: rawNodes.map((n, i) => {
            const node = n as {
              id: string;
              type: string;
              position?: [number, number];
              parameters?: Record<string, unknown>;
            };
            return { ...node, position: node.position ?? ([0, i * 100] as [number, number]) };
          }),
          edges: rawEdges,
        };
        const nodeExecutor = new NodeAgentExecutor();
        output = await nodeExecutor.execute(
          { graph: graph as Canvas, sharedContextKeys: [], toolIds, defaultLlmConfigId },
          input,
          { ...context, prompts: {} as Record<string, PromptTemplate> }
        );
      }
      const turns =
        (sharedContext.get("__recent_turns") as
          | Array<{ speaker: string; text: string }>
          | undefined) ?? [];
      turns.push({ speaker: agent.name, text: String(output ?? "") });
      if (turns.length > WORKFLOW_MEMORY_MAX_RECENT_TURNS)
        turns.splice(0, turns.length - WORKFLOW_MEMORY_MAX_RECENT_TURNS);
      sharedContext.set("__recent_turns", turns);
      sharedContext.set(`__agentName_${nodeId}`, agent.name);

      step.output = output;
      if (toolCallsForStep.length > 0) step.toolCalls = [...toolCallsForStep];
      trail.push(step);
      await insertWorkflowMessage({
        executionId: runId,
        nodeId,
        agentId,
        role: "agent",
        content: typeof output === "string" ? output : JSON.stringify(output ?? ""),
      });
      await options.onStepComplete?.(trail, output);
      return output;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      step.error = errMsg;
      if (toolCallsForStep.length > 0) step.toolCalls = [...toolCallsForStep];
      trail.push(step);
      // Persist agent/code execution errors to run_logs for any workflow run (debugging, iterative improvement)
      if (errMsg !== WAITING_FOR_USER_MESSAGE) {
        const kind = agent.kind ?? "llm";
        const sourceTag = kind === "code" ? "[Code agent]" : "[Agent]";
        const payloadObj: Record<string, unknown> = {
          source: kind === "code" ? "code_agent" : "agent",
          nodeId,
          agentId: agent.id,
          agentName: agent.name,
          kind,
          error: errMsg.slice(0, 1000),
        };
        if (errStack) payloadObj.stack = errStack.slice(0, 1500);
        void db
          .insert(runLogs)
          .values({
            id: crypto.randomUUID(),
            executionId: runId,
            level: "stderr",
            message: `${sourceTag} ${errMsg}`,
            payload: JSON.stringify(payloadObj),
            createdAt: Date.now(),
          })
          .run();
      }
      // Do not overwrite run output when request_user_help just wrote the waiting payload
      if (err instanceof Error && err.message !== WAITING_FOR_USER_MESSAGE) {
        await options.onStepComplete?.(trail, undefined);
      }
      if (err instanceof Error && err.message === WAITING_FOR_USER_MESSAGE) {
        throw new WaitingForUserError(WAITING_FOR_USER_MESSAGE, trail);
      }
      throw err;
    }
  };

  const handlers: Record<
    string,
    (
      nodeId: string,
      config: Record<string, unknown> | undefined,
      sharedContext: unknown
    ) => Promise<unknown>
  > = {
    agent: (nodeId, config, sharedContext) =>
      agentHandler(
        nodeId,
        config,
        sharedContext as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }
      ),
    wait_for_user: async (nodeId, config) => {
      const question =
        (config?.question as string) ??
        (config?.message as string) ??
        "Please respond to continue.";
      trail.push({
        nodeId,
        agentId: "",
        agentName: "Wait for user",
        order: stepOrder++,
        input: question,
        output: undefined,
        error: undefined,
        inputIsUserReply: false,
      });
      await options.onStepComplete?.(trail, undefined);
      throw new WaitingForUserError(WAITING_FOR_USER_MESSAGE, trail);
    },
  };

  await ensureStandardTools();
  const engine = new WorkflowEngine();
  const initialContext: Record<string, unknown> = { __recent_turns: [], __summary: "" };
  await options.onProgress?.({ message: "Starting workflow…" }, trail);

  let result: { output: unknown; context: Record<string, unknown> };

  if (USE_EVENT_DRIVEN_ENGINE) {
    const startNodeId = (workflowForEngine.nodes ?? [])[0]?.id;
    if (!startNodeId) {
      result = { output: undefined, context: initialContext };
    } else {
      let state = await getExecutionRunState(runId);
      if (state?.trailSnapshot) {
        const snap =
          typeof state.trailSnapshot === "string"
            ? (JSON.parse(state.trailSnapshot) as ExecutionTraceStep[])
            : (state.trailSnapshot as ExecutionTraceStep[]);
        if (Array.isArray(snap)) {
          trail.length = 0;
          trail.push(...snap);
          stepOrder = snap.reduce((m, s) => Math.max(m, (s.order ?? 0) + 1), 0);
        }
      }
      if (options.resumeUserResponse?.trim() && state) {
        await enqueueExecutionEvent(runId, "UserResponded", {
          content: options.resumeUserResponse.trim(),
        });
      }
      if (!state) {
        await setExecutionRunState(runId, {
          workflowId,
          targetBranchId: branchId ?? null,
          currentNodeId: startNodeId,
          round: 0,
          sharedContext: initialContext,
          status: "running",
        });
        if (!options.resumeUserResponse?.trim()) {
          await enqueueExecutionEvent(runId, "RunStarted");
          await enqueueExecutionEvent(runId, "NodeRequested", { nodeId: startNodeId });
        }
      }

      async function processOneEvent(event: {
        id: string;
        type: string;
        payload: Record<string, unknown> | null;
      }): Promise<"continue" | "waiting" | "completed"> {
        if (event.type === "RunStarted") {
          await markEventProcessed(event.id);
          return "continue";
        }
        if (event.type === "NodeRequested") {
          const nodeId = (event.payload?.nodeId as string) ?? "";
          const node = (workflowForEngine.nodes ?? []).find((n) => n.id === nodeId);
          if (!node) {
            await markEventProcessed(event.id);
            return "continue";
          }
          state = await getExecutionRunState(runId);
          if (!state || state.status !== "running") {
            await markEventProcessed(event.id);
            return "completed";
          }
          const ctx = new SharedContextManager(
            parseRunStateSharedContext(state) as Record<string, unknown>
          );
          const nodeParams = node as {
            parameters?: Record<string, unknown>;
            config?: Record<string, unknown>;
          };
          const config = nodeParams.parameters ?? nodeParams.config ?? {};
          const handler = handlers[node.type];
          if (!handler) {
            await markEventProcessed(event.id);
            return "continue";
          }
          try {
            const output = await handler(nodeId, config, ctx);
            const snapshot = ctx.snapshot();
            snapshot[`__output_${nodeId}`] = output;
            await setExecutionRunState(runId, {
              workflowId: state.workflowId,
              targetBranchId: state.targetBranchId,
              currentNodeId: nodeId,
              round: state.round,
              sharedContext: snapshot,
              status: "running",
              trailSnapshot: trail,
            });
            await enqueueExecutionEvent(runId, "NodeCompleted", { nodeId, output });
            await markEventProcessed(event.id);
            return "continue";
          } catch (err) {
            if (err instanceof WaitingForUserError) {
              await updateExecutionRunState(runId, {
                status: "waiting_for_user",
                waitingAtNodeId: nodeId,
                trailSnapshot: trail,
              });
              await markEventProcessed(event.id);
              return "waiting";
            }
            throw err;
          }
        }
        if (event.type === "NodeCompleted") {
          const nodeId = (event.payload?.nodeId as string) ?? "";
          const output = event.payload?.output;
          state = await getExecutionRunState(runId);
          if (!state) {
            await markEventProcessed(event.id);
            return "completed";
          }
          const { nextNodeId, nextRound, completed } = computeNextNodeId(
            nodeId,
            output,
            state.round
          );
          if (completed) {
            await updateExecutionRunState(runId, { status: "completed", round: nextRound });
            await markEventProcessed(event.id);
            return "completed";
          }
          if (nextNodeId) {
            if (trail.length > 0) {
              const lastStep = trail[trail.length - 1] as ExecutionTraceStep;
              lastStep.sentToNodeId = nextNodeId;
            }
            await updateExecutionRunState(runId, { currentNodeId: nextNodeId, round: nextRound });
            await enqueueExecutionEvent(runId, "NodeRequested", { nodeId: nextNodeId });
          }
          await markEventProcessed(event.id);
          return "continue";
        }
        if (event.type === "UserResponded") {
          const content = (event.payload?.content as string) ?? "";
          state = await getExecutionRunState(runId);
          if (!state || !state.waitingAtNodeId) {
            await markEventProcessed(event.id);
            return "completed";
          }
          const waitingNodeId = state.waitingAtNodeId;
          const ctx = parseRunStateSharedContext(state) as Record<string, unknown>;
          ctx.__user_response = content;
          const { nextNodeId } = computeNextNodeId(waitingNodeId, content, state.round);
          await setExecutionRunState(runId, {
            workflowId: state.workflowId,
            targetBranchId: state.targetBranchId,
            currentNodeId: state.currentNodeId,
            round: state.round,
            sharedContext: ctx,
            status: "running",
            waitingAtNodeId: null,
          });
          if (nextNodeId)
            await enqueueExecutionEvent(runId, "NodeRequested", { nodeId: nextNodeId });
          await markEventProcessed(event.id);
          return "continue";
        }
        await markEventProcessed(event.id);
        return "continue";
      }

      while (true) {
        const event = await getNextPendingEvent(runId);
        if (!event) {
          const s = await getExecutionRunState(runId);
          if (s?.status === "running")
            await updateExecutionRunState(runId, { status: "completed" });
          break;
        }
        if (options.isCancelled && (await options.isCancelled()))
          throw new Error(RUN_CANCELLED_MESSAGE);
        const outcome = await processOneEvent(event);
        if (outcome === "waiting") {
          throw new WaitingForUserError(WAITING_FOR_USER_MESSAGE, trail);
        }
        if (outcome === "completed") break;
      }

      state = await getExecutionRunState(runId);
      const ctx = state ? parseRunStateSharedContext(state) : initialContext;
      const nodes = workflowForEngine.nodes ?? [];
      const lastNodeId = state?.currentNodeId ?? nodes[nodes.length - 1]?.id;
      const output = lastNodeId && ctx ? (ctx[`__output_${lastNodeId}`] as unknown) : undefined;
      result = { output: output ?? ctx?.output, context: ctx ?? initialContext };
    }
  } else {
    result = await engine.execute(workflowForEngine, handlers, initialContext);
  }

  for (const entry of usageEntries) {
    const usage = entry.response.usage;
    if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
      const pricing = resolveModelPricing(entry.config.model, customPricing);
      const cost = calculateCost(usage.promptTokens, usage.completionTokens, pricing);
      await db
        .insert(tokenUsage)
        .values(
          toTokenUsageRow({
            id: crypto.randomUUID(),
            executionId: runId,
            agentId: entry.agentId ?? null,
            workflowId,
            provider: entry.config.provider,
            model: entry.config.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            estimatedCost: cost != null ? String(cost) : null,
          })
        )
        .run();
    }
  }

  return { ...result, trail };
}
