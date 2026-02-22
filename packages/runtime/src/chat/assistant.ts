import type { LLMRequest, LLMResponse, LLMMessage } from "../llm/types";
import { ASSISTANT_TOOLS, SYSTEM_PROMPT, type AssistantToolDef } from "./tools";

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** Tracking fields in tool arguments; stripped before calling the tool. */
const TRACKING_KEYS = ["todoIndex", "subStepIndex", "subStepLabel", "completeTodo"] as const;

export interface AssistantProgress {
  onPlan?(reasoning: string, todos: string[]): void;
  /** Called before executing each tool (todoIndex when plan present, else step index; optional subStepLabel for multi-step todos) */
  onStepStart?(stepIndex: number, todoLabel: string, toolName: string, subStepLabel?: string): void;
  /** Called when a todo is marked complete (completeTodo: true) or after each tool when no plan; index = todo index. */
  onToolDone?(index: number, name: string, result: unknown): void;
}

export interface StudioContext {
  tools?: { id: string; name: string; protocol: string }[];
  agents?: { id: string; name: string; kind: string }[];
  workflows?: { id: string; name: string; executionMode: string }[];
  llmProviders?: { id: string; provider: string; model: string }[];
  connectors?: { id: string; type: string }[];
}

export interface AssistantOptions {
  callLLM: (request: LLMRequest) => Promise<LLMResponse>;
  executeTool: ToolExecutor;
  feedbackInjection?: string;
  /** Optional RAG context (e.g. from studio knowledge) to include in the system prompt */
  ragContext?: string;
  /** Optional UI context: where the user is in the app (e.g. "Workflow detail page") for relevant answers */
  uiContext?: string;
  /** Optional attached context (e.g. run output) the user shared so the assistant can help without paste */
  attachedContext?: string;
  /** Optional studio context: available tools, agents, workflows so the assistant knows what exists without calling list_* first */
  studioContext?: StudioContext;
  /** Optional cross-chat context: stored preferences + recent conversation summaries (injected after studio context) */
  crossChatContext?: string;
  /** Optional: when a workflow run is waiting for user input, inject this context so the assistant can decide to call respond_to_run or take another action */
  runWaitingContext?: string;
  /** Optional: LLM currently selected in the chat UI. When user says "use this one", "same as chat", or doesn't specify, use this as llmConfigId for new agents. */
  chatSelectedLlm?: { id: string; provider: string; model: string };
  /** Optional custom system prompt override (replaces default; rag/feedback/ui/attached/studio context still appended) */
  systemPromptOverride?: string;
  /** Optional progress callbacks: onPlan before running tools, onToolDone after each tool */
  onProgress?: AssistantProgress;
  /** LLM temperature (0–2). If set, used for all callLLM requests in this turn. Defaults: 0.4 main, 0.2 nudge. */
  temperature?: number;
  /** Max completion tokens for LLM responses. Use a generous value (e.g. 16384) so long tool calls (e.g. execute_code with large commands) are not truncated. */
  maxTokens?: number;
  /** Max follow-up rounds when there are tool results (default 2). Use 0 for "continue from shell approval" to save LLM calls. */
  maxFollowUpRounds?: number;
}

export interface AssistantResponse {
  content: string;
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[];
  /** Parsed from first LLM response when the assistant explains its plan */
  reasoning?: string;
  /** Parsed list of planned steps (order should match tool execution) */
  todos?: string[];
  /** Indices into todos that are done (first N tool results map to first N todos) */
  completedStepIndices?: number[];
}

/**
 * Runs one turn of the assistant conversation.
 * Handles tool calls by executing them and feeding results back to the LLM.
 */
export async function runAssistant(
  history: LLMMessage[],
  userMessage: string,
  options: AssistantOptions
): Promise<AssistantResponse> {
  let systemPrompt = options.systemPromptOverride ?? SYSTEM_PROMPT;
  if (options.ragContext) {
    systemPrompt += `\n\n## Knowledge base\nUse the following context when relevant to answer the user.\n\n${options.ragContext}`;
  }
  if (options.feedbackInjection) {
    systemPrompt += `\n\n${options.feedbackInjection}`;
  }
  if (options.uiContext) {
    systemPrompt += `\n\n## Current UI location\n${options.uiContext}\nUse agent/workflow/run IDs from this context directly when the user asks to fix or populate — no need to ask for them.`;
  }
  if (options.attachedContext) {
    systemPrompt += `\n\n## User-shared context (e.g. run output)\nThe user opened the chat with the following content attached so you can help directly. Use it to answer their question or debug.\n\n${options.attachedContext}`;
  }
  if (
    options.studioContext != null &&
    typeof options.studioContext === "object" &&
    !Array.isArray(options.studioContext)
  ) {
    const ctx = options.studioContext;
    const parts: string[] = [];
    const tools = Array.isArray(ctx.tools) ? ctx.tools : [];
    if (tools.length > 0) {
      parts.push(
        `Tools available (use these IDs in toolIds when creating/updating agents):\n${tools.map((t) => `- ${t.id}: ${t.name} (${t.protocol})`).join("\n")}`
      );
    }
    const agents = Array.isArray(ctx.agents) ? ctx.agents : [];
    if (agents.length > 0) {
      parts.push(`Agents: ${agents.map((a) => `${a.name} (${a.id})`).join(", ")}`);
    }
    const workflows = Array.isArray(ctx.workflows) ? ctx.workflows : [];
    if (workflows.length > 0) {
      parts.push(`Workflows: ${workflows.map((w) => `${w.name} (${w.id})`).join(", ")}`);
    }
    const llmProviders = Array.isArray(ctx.llmProviders) ? ctx.llmProviders : [];
    if (llmProviders.length > 0) {
      parts.push(
        `LLM providers (use these IDs as llmConfigId when creating/updating agents):\n${llmProviders.map((p) => `- ${p.id}: ${p.provider} / ${p.model}`).join("\n")}`
      );
    }
    const connectors = Array.isArray(ctx.connectors) ? ctx.connectors : [];
    if (connectors.length > 0) {
      parts.push(
        `Knowledge connectors (use these IDs with list_connector_items, connector_read_item, connector_update_item):\n${connectors.map((c) => `- ${c.id}: ${c.type}`).join("\n")}`
      );
    }
    if (parts.length > 0) {
      systemPrompt += `\n\n## Studio resources (current state)\n${parts.join("\n\n")}`;
    }
  }
  if (options.chatSelectedLlm) {
    const { id, provider, model } = options.chatSelectedLlm;
    systemPrompt += `\n\n## Chat-selected LLM\nThe user has this LLM selected in the chat dropdown: id ${id} (${provider} / ${model}). When they say "use this one", "same as chat", "default", "current", or do not specify which LLM to use for new agents, use this id as llmConfigId. You may still ask to confirm ("Use ${provider} ${model} for these agents?") if there are multiple providers and the user was ambiguous.`;
  }
  if (options.crossChatContext && options.crossChatContext.trim().length > 0) {
    systemPrompt += `\n\n## Cross-chat context (preferences and recent conversation summaries)\n${options.crossChatContext.trim()}`;
  }
  if (options.runWaitingContext && options.runWaitingContext.trim().length > 0) {
    systemPrompt += `\n\n## Workflow run(s) context\n${options.runWaitingContext.trim()}\n\n**CRITICAL:** Do NOT output a generic "The agent is waiting for your input. Reply above to continue." message. Instead:
1. Always know which run you are referring to (runId). When multiple runs are listed (e.g. one waiting for input, one executing), if the user's message does not clearly refer to one run, ask: "Do you mean the run waiting for your input, or the one that's still executing?" — then use the correct runId for get_run, respond_to_run, or cancel_run.
2. First, surface the run's question to the user when relevant (from runWaitingContext above) so they know what to reply.
3. Then process their message: (a) If they are directly answering a run's question (e.g. selecting an option, providing data), call respond_to_run with that run's runId and response. (b) If they want to stop or cancel a run, call cancel_run with that run's runId. (c) If they want something else (modify the agent, ask a different question), do that instead. Always take action — never just tell them to reply.
4. For respond_to_run: set **response** to the **exact** text the user sent (the full option label if they clicked one, or their typed reply). Never use a number, index, or abbreviation (e.g. never "1" or "option 2" — use the full option text like "Wait for saved searches (do nothing)").`;
  }

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  const mainTemp = options.temperature ?? 0.4;
  const nudgeTemp = options.temperature ?? 0.2;

  // First LLM call (use generous maxTokens so long tool calls are not truncated)
  const response = await options.callLLM({
    messages,
    temperature: mainTemp,
    ...(options.maxTokens != null ? { maxTokens: options.maxTokens } : {}),
  });

  const rawContent = response.content;

  // Parse optional <reasoning> and <todos> for planning display
  let reasoning: string | undefined;
  let todos: string[] | undefined;
  const reasoningMatch = rawContent.match(/<reasoning>\s*([\s\S]*?)<\/reasoning>/i);
  if (reasoningMatch) {
    reasoning = reasoningMatch[1].trim();
  }
  const todosMatch = rawContent.match(/<todos>\s*([\s\S]*?)<\/todos>/i);
  if (todosMatch) {
    const block = todosMatch[1].trim();
    todos = block
      .split(/\n/)
      .map((line) =>
        line
          .replace(/^\s*[-*•]\s*/, "")
          .replace(/^\s*\d+\.\s*/, "")
          .trim()
      )
      .filter((line) => line.length > 0);
  }

  // Track which todo indices actually had a successful tool execution, so we can
  // report completed steps based on real tool runs instead of assuming a prefix.
  const completedTodoIndices = new Set<number>();

  // Notify plan before executing any tools (so UI can show reasoning + todos immediately)
  if (options.onProgress?.onPlan && (reasoning || (todos && todos.length > 0))) {
    options.onProgress.onPlan(reasoning ?? "", todos ?? []);
  }

  // Parse tool calls: extract JSON from <tool_call>...</tool_call> or <|tool_call_start|>...<|tool_call_end|>
  // When todos exist, use todoIndex/completeTodo from args (multi-step per todo). Otherwise use position-based step index.
  async function extractAndRunToolCalls(
    text: string,
    options_: { startIndex?: number; todos?: string[]; maxSteps?: number } = {}
  ): Promise<{ name: string; args: Record<string, unknown>; result: unknown }[]> {
    const { startIndex = 0, todos: todosForSteps = [], maxSteps } = options_;
    const useTodoIndexMode = todosForSteps.length > 0;
    const results: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
    const extractBlocks = (pattern: RegExp): string[] => {
      const blocks: string[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(pattern.source, "gi");
      while ((m = re.exec(text)) !== null) {
        const afterTag = m.index + m[0].length;
        const braceStart = text.indexOf("{", afterTag);
        if (braceStart === -1) continue;
        let depth = 0;
        let end = braceStart;
        for (let i = braceStart; i < text.length; i++) {
          const c = text[i];
          if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        blocks.push(text.slice(braceStart, end));
      }
      return blocks;
    };
    const blocks =
      extractBlocks(/<tool_call>\s*/).length > 0
        ? extractBlocks(/<tool_call>\s*/)
        : extractBlocks(/<\|tool_call_start\|>\s*/);
    let index = 0;
    for (const jsonStr of blocks) {
      try {
        const call = JSON.parse(jsonStr);
        const name = call.name || call.tool;
        if (!name) continue;
        const rawArgs = call.arguments ?? call.args;
        const args = (
          rawArgs != null && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {}
        ) as Record<string, unknown>;
        // Resolve todo index: from args when in todo-index mode, else position-based
        let stepIndex: number;
        let completeTodo = false;
        let subStepLabel: string | undefined;
        if (useTodoIndexMode) {
          const rawTodoIndex = args.todoIndex;
          stepIndex =
            typeof rawTodoIndex === "number" && Number.isInteger(rawTodoIndex) && rawTodoIndex >= 0
              ? Math.min(rawTodoIndex, todosForSteps.length - 1)
              : startIndex + index;
          completeTodo = args.completeTodo === true;
          if (typeof args.subStepLabel === "string" && args.subStepLabel.trim())
            subStepLabel = args.subStepLabel.trim();
        } else {
          stepIndex = startIndex + index;
          if (typeof maxSteps === "number" && maxSteps >= 0 && stepIndex >= maxSteps) break;
        }
        const todoLabel = todosForSteps[stepIndex] ?? `Step ${stepIndex + 1}`;
        // Strip tracking fields so the tool implementation does not receive them
        const argsForTool = { ...args };
        for (const key of TRACKING_KEYS) delete argsForTool[key];
        options.onProgress?.onStepStart?.(stepIndex, todoLabel, name, subStepLabel);
        const result = await options.executeTool(name, argsForTool);
        results.push({ name, args: argsForTool, result });
        if (useTodoIndexMode) {
          if (completeTodo && stepIndex >= 0 && stepIndex < todosForSteps.length) {
            completedTodoIndices.add(stepIndex);
            options.onProgress?.onToolDone?.(stepIndex, name, result);
          }
        } else {
          options.onProgress?.onToolDone?.(stepIndex, name, result);
          if (stepIndex >= 0 && stepIndex < todosForSteps.length)
            completedTodoIndices.add(stepIndex);
        }
        index++;
        if (
          (name === "ask_user" || name === "ask_credentials") &&
          result != null &&
          typeof result === "object" &&
          (result as { waitingForUser?: boolean }).waitingForUser === true
        ) {
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/malformed|json|parse/i.test(msg)) {
          // skip malformed tool call JSON only
        } else {
          throw err;
        }
      }
    }
    return results;
  }

  // Only cap by todo count when we have at least one todo; otherwise run all tool calls from the first message
  const initialMaxSteps = (todos?.length ?? 0) > 0 ? todos!.length : undefined;
  let toolResults = await extractAndRunToolCalls(rawContent, {
    todos: todos ?? [],
    maxSteps: initialMaxSteps,
  });

  // If the model gave no tool calls but the user asked for action, nudge to output tool calls
  let effectiveAssistantContent = rawContent;
  const userLower = userMessage.trim().toLowerCase();
  const actionKeywords =
    /\b(create|add|fix|configure|set up|update|make|build|workflow|workflows|agents?|tools?|llm|graph|outputs?|produce)\b/;
  const looksLikeActionRequest = actionKeywords.test(userLower);
  if (toolResults.length === 0 && looksLikeActionRequest) {
    const possibleTruncation =
      /<tool_call>\s*\{/i.test(rawContent) && rawContent.trim().length > 500;
    const nudgeContent = possibleTruncation
      ? 'Your previous response may have been cut off before the tool_call JSON was complete. Output the required <tool_call> block(s) again. For execute_code: use SHORT commands — split long sequences into multiple execute_code calls (e.g. one for clone, one for apt-get install, one for make) so each call stays under ~1500 characters and is not truncated. Use this exact format: <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>. Output only the tool_call blocks.'
      : 'You responded with text but did not output any <tool_call> blocks. The user asked you to perform actions (create/configure/fix agents, workflows, or tools). You MUST output the required <tool_call> blocks now so the system can execute them. Start by listing or getting current state if needed (e.g. list_workflows, get_workflow, list_agents, list_llm_providers, list_tools), then create or update as needed. Use this exact format for each call: <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>. When you have <todos>, include "todoIndex" and "completeTodo": true in each tool\'s arguments. Output only the tool_call blocks, one after another.';
    const nudgeMessages: LLMMessage[] = [
      ...messages,
      { role: "assistant", content: rawContent },
      { role: "user", content: nudgeContent },
    ];
    const nudgeResponse = await options.callLLM({
      messages: nudgeMessages,
      temperature: nudgeTemp,
      ...(options.maxTokens != null ? { maxTokens: options.maxTokens } : {}),
    });
    const nudgeResults = await extractAndRunToolCalls(nudgeResponse.content, {
      todos: todos ?? [],
      maxSteps: todos?.length,
    });
    if (nudgeResults.length > 0) {
      toolResults = nudgeResults;
      effectiveAssistantContent = nudgeResponse.content;
    }
  }

  // If the model asked the user for input (ask_user or ask_credentials with waitingForUser), do not nudge for more tool calls this turn
  const waitingForUser = toolResults.some(
    (r) =>
      (r.name === "ask_user" || r.name === "ask_credentials") &&
      r.result != null &&
      typeof r.result === "object" &&
      (r.result as { waitingForUser?: boolean }).waitingForUser === true
  );

  // If the model output a plan but not all todos are complete, nudge (unless waiting for user input)
  const expectedSteps = todos?.length ?? 0;
  const todosComplete = expectedSteps > 0 && completedTodoIndices.size >= expectedSteps;
  const shouldNudgeMissingCalls = expectedSteps > 0 && !waitingForUser && !todosComplete;
  if (shouldNudgeMissingCalls) {
    const toolsSummary =
      toolResults.length > 0
        ? "\n\nContext: tools you already ran this turn and their results:\n" +
          toolResults.map((r) => `- ${r.name}: ${JSON.stringify(r.result)}`).join("\n")
        : "";
    const nudgeMessages: LLMMessage[] = [
      ...messages,
      { role: "assistant", content: rawContent },
      {
        role: "user",
        content:
          (toolResults.length === 0
            ? 'You listed steps but did not output any <tool_call> blocks. Output them now. For each step include "todoIndex" (0-based) and set "completeTodo": true on the last tool call for that step. Use the exact format: <tool_call>{"name": "create_agent", "arguments": {"todoIndex": 0, "completeTodo": true, ...}}</tool_call>. Do not add explanation, only the tool_call blocks.'
            : `You listed ${expectedSteps} steps but ${completedTodoIndices.size} are marked complete (completeTodo: true). Output <tool_call> blocks for the remaining step(s). Each call must include \"todoIndex\" and set \"completeTodo\": true on the last tool for that todo. Only the missing tool_call blocks.`) +
          toolsSummary,
      },
    ];
    const nudgeResponse = await options.callLLM({
      messages: nudgeMessages,
      temperature: nudgeTemp,
      ...(options.maxTokens != null ? { maxTokens: options.maxTokens } : {}),
    });
    const moreResults = await extractAndRunToolCalls(nudgeResponse.content, {
      startIndex: toolResults.length,
      todos: todos ?? [],
    });
    toolResults = [...toolResults, ...moreResults];
  }

  // Completed steps: use the indices where we actually ran at least one tool
  // mapped to a todo (i.e. stepIndex within todos length). This avoids
  // over-marking later todos as done when additional tools run for earlier steps.
  const completedStepIndices: number[] = Array.from(completedTodoIndices).sort((a, b) => a - b);

  // Multi-round: if we got tool results, do one follow-up to allow e.g. update_workflow after create_agent; avoid re-running creation.
  let content = effectiveAssistantContent;
  const maxRounds = options.maxFollowUpRounds ?? 2;
  let round = 0;
  let lastAssistantContent = effectiveAssistantContent;
  let allToolResults = [...toolResults];

  const followUpReminderText =
    "[System reminder: You already ran tool calls this turn. If your results above include create_workflow and create_agent ids, you MUST call update_workflow now for each such workflow: pass id (workflow id from results), nodes (one per agent with parameters.agentId = exact agent id from results), edges (e.g. n1→n2 and n2→n1 for a chat loop), and maxRounds. maxRounds = number of full cycles (one cycle = each agent speaks once): for a 2-agent chat, '3 rounds each' means maxRounds: 3 (6 steps total), NOT 6. Do NOT run create_agent or create_workflow again. After update_workflow you may call execute_workflow if the user wanted to run. You MUST also call format_response with summary, needsInput, and options (e.g. ['Run it now', 'Modify agent', 'Not now']) so the user gets clickable choices — do not end with prose only. If an execute_workflow result is in the results above, inspect its output.trail: if the agents' conversation does not match the user's goal (e.g. should discuss weather but did not), call update_agent (e.g. add toolIds like std-weather, tighten systemPrompt) and execute_workflow again — at most 2–3 improvement rounds total. You MUST respond to the user in this message.]";

  const followUpSummaryInstruction =
    "You MUST respond to the user in this turn: give a short summary of what was done and either (a) ask for their input (e.g. run the workflow now? need more information?) or (b) state what they can do next. Do not end the turn without a clear message to the user.";

  while (toolResults.length > 0 && round < maxRounds && !waitingForUser) {
    // Provide prior tool results back to the model as plain text so this works with any provider,
    // without relying on provider-specific tool-calling APIs.
    const toolsSummary = toolResults
      .map((r, i) => {
        const argsText = typeof r.args === "string" ? r.args : JSON.stringify(r.args ?? {});
        const resultText =
          typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? null);
        return `Tool ${i + 1}: ${r.name}\n  arguments: ${argsText}\n  result: ${resultText}`;
      })
      .join("\n\n");

    const isFirstFollowUp = round === 0;
    const hasToolCapExceeded = toolResults.some(
      (r) =>
        r.result != null &&
        typeof r.result === "object" &&
        (r.result as { code?: string }).code === "TOOL_CAP_EXCEEDED"
    );
    const firstFollowUpLead = hasToolCapExceeded
      ? "One or more create_agent calls failed with TOOL_CAP_EXCEEDED (max 10 tools per agent). You MUST design and create a multi-agent system using an agentic pattern (pipeline A→B→C, evaluator-optimizer A↔B with maxRounds, role-based assembly line, or orchestrator-workers): create multiple agents (each with at most 10 tools and a clear role in that pattern) and report each with [Created agent id: ...]. If you have create_workflow and update_workflow, also create the workflow and wire these agents (nodes with parameters.agentId, edges, maxRounds) according to the pattern. If not (e.g. you are the agent specialist), respond with the agent ids and the chosen pattern so the workflow specialist can wire them. Then respond with a summary and options for the user."
      : "Now, based on these tool results and the user's goal, continue. " +
        "If you created workflow(s) and agent(s) above, you MUST call update_workflow for each workflow with the exact ids from the results (nodes with agentId, edges, maxRounds). Do NOT re-run create_agent or create_workflow. ";
    const followUpUserContent =
      "Earlier in this turn you already ran these tool calls:\n\n" +
      toolsSummary +
      "\n\n" +
      (isFirstFollowUp ? firstFollowUpLead : "No further tool calls are needed. ") +
      followUpSummaryInstruction +
      "\n\n" +
      followUpReminderText;

    const followUpMessages: LLMMessage[] = [
      ...messages,
      { role: "assistant", content: lastAssistantContent },
      { role: "user", content: followUpUserContent },
    ];

    const followUp = await options.callLLM({
      messages: followUpMessages,
      temperature: mainTemp,
    });

    lastAssistantContent = followUp.content;
    content = followUp.content;

    // Parse and execute any tool calls in the follow-up (e.g. update_agent, create_agent with data from prior tool results).
    // Do not pass maxSteps here: we want to run ALL tool calls in the follow-up. (maxSteps on the first message limits
    // initial batch; follow-ups can add more tools without being capped by the original todo count.)
    toolResults = await extractAndRunToolCalls(followUp.content, {
      startIndex: allToolResults.length,
      todos: todos ?? [],
    });
    for (let i = 0; i < toolResults.length; i++) {
      allToolResults.push(toolResults[i]);
    }
    round++;
  }

  toolResults = allToolResults;

  // Clean tool_call and optional planning tags from final content
  content = content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<todos>[\s\S]*?<\/todos>/gi, "")
    .trim();

  return {
    content,
    toolResults,
    ...(reasoning && { reasoning }),
    ...(todos && todos.length > 0 && { todos, completedStepIndices }),
  };
}

export { ASSISTANT_TOOLS, SYSTEM_PROMPT };
