import type { LLMRequest, LLMResponse, LLMMessage } from "../llm/types";
import { ASSISTANT_TOOLS, SYSTEM_PROMPT, type AssistantToolDef } from "./tools";

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface AssistantProgress {
  onPlan?(reasoning: string, todos: string[]): void;
  /** Called before executing each tool (step index 0-based, todo label from todos[stepIndex]) */
  onStepStart?(stepIndex: number, todoLabel: string, toolName: string): void;
  onToolDone?(index: number, name: string, result: unknown): void;
}

export interface StudioContext {
  tools?: { id: string; name: string; protocol: string }[];
  agents?: { id: string; name: string; kind: string }[];
  workflows?: { id: string; name: string; executionMode: string }[];
  llmProviders?: { id: string; provider: string; model: string }[];
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
  /** Optional custom system prompt override (replaces default; rag/feedback/ui/attached/studio context still appended) */
  systemPromptOverride?: string;
  /** Optional progress callbacks: onPlan before running tools, onToolDone after each tool */
  onProgress?: AssistantProgress;
  /** LLM temperature (0–2). If set, used for all callLLM requests in this turn. Defaults: 0.4 main, 0.2 nudge. */
  temperature?: number;
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
  if (options.studioContext != null && typeof options.studioContext === "object" && !Array.isArray(options.studioContext)) {
    const ctx = options.studioContext;
    const parts: string[] = [];
    const tools = Array.isArray(ctx.tools) ? ctx.tools : [];
    if (tools.length > 0) {
      parts.push(`Tools available (use these IDs in toolIds when creating/updating agents):\n${tools.map((t) => `- ${t.id}: ${t.name} (${t.protocol})`).join("\n")}`);
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
      parts.push(`LLM providers (use these IDs as llmConfigId when creating/updating agents):\n${llmProviders.map((p) => `- ${p.id}: ${p.provider} / ${p.model}`).join("\n")}`);
    }
    if (parts.length > 0) {
      systemPrompt += `\n\n## Studio resources (current state)\n${parts.join("\n\n")}`;
    }
  }
  if (options.crossChatContext && options.crossChatContext.trim().length > 0) {
    systemPrompt += `\n\n## Cross-chat context (preferences and recent conversation summaries)\n${options.crossChatContext.trim()}`;
  }

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  const mainTemp = options.temperature ?? 0.4;
  const nudgeTemp = options.temperature ?? 0.2;

  // First LLM call
  const response = await options.callLLM({
    messages,
    temperature: mainTemp,
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
      .map((line) => line.replace(/^\s*[-*•]\s*/, "").replace(/^\s*\d+\.\s*/, "").trim())
      .filter((line) => line.length > 0);
  }

  // Notify plan before executing any tools (so UI can show reasoning + todos immediately)
  if (options.onProgress?.onPlan && (reasoning || (todos && todos.length > 0))) {
    options.onProgress.onPlan(reasoning ?? "", todos ?? []);
  }

  // Parse tool calls: extract JSON from <tool_call>...</tool_call> or <|tool_call_start|>...<|tool_call_end|>
  async function extractAndRunToolCalls(
    text: string,
    options_: { startIndex?: number; todos?: string[] } = {}
  ): Promise<{ name: string; args: Record<string, unknown>; result: unknown }[]> {
    const { startIndex = 0, todos: todosForSteps = [] } = options_;
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
        const args = (rawArgs != null && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>;
        const stepIndex = startIndex + index;
        const todoLabel = todosForSteps[stepIndex] ?? `Step ${stepIndex + 1}`;
        options.onProgress?.onStepStart?.(stepIndex, todoLabel, name);
        const result = await options.executeTool(name, args);
        results.push({ name, args, result });
        options.onProgress?.onToolDone?.(stepIndex, name, result);
        index++;
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

  let toolResults = await extractAndRunToolCalls(rawContent, { todos: todos ?? [] });

  // If the model gave no tool calls but the user asked for action, nudge to output tool calls
  let effectiveAssistantContent = rawContent;
  const userLower = userMessage.trim().toLowerCase();
  const actionKeywords = /\b(create|add|fix|configure|set up|update|make|build|workflow|workflows|agents?|tools?|llm|graph|outputs?|produce)\b/;
  const looksLikeActionRequest = actionKeywords.test(userLower);
  if (toolResults.length === 0 && looksLikeActionRequest) {
    const nudgeMessages: LLMMessage[] = [
      ...messages,
      { role: "assistant", content: rawContent },
      {
        role: "user",
        content:
          "You responded with text but did not output any <tool_call> blocks. The user asked you to perform actions (create/configure/fix agents, workflows, or tools). You MUST output the required <tool_call> blocks now so the system can execute them. Start by listing or getting current state if needed (e.g. list_workflows, get_workflow, list_agents, list_llm_providers, list_tools), then create or update as needed. Use this exact format for each call: <tool_call>{\"name\": \"tool_name\", \"arguments\": {...}}</tool_call>. Output only the tool_call blocks, one after another.",
      },
    ];
    const nudgeResponse = await options.callLLM({
      messages: nudgeMessages,
      temperature: nudgeTemp,
    });
    const nudgeResults = await extractAndRunToolCalls(nudgeResponse.content, { todos: todos ?? [] });
    if (nudgeResults.length > 0) {
      toolResults = nudgeResults;
      effectiveAssistantContent = nudgeResponse.content;
    }
  }

  // If the model output a plan but no tool calls, nudge it to output them
  const expectedSteps = todos?.length ?? 0;
  if (toolResults.length < expectedSteps && expectedSteps > 0) {
    const nudgeMessages: LLMMessage[] = [
      ...messages,
      { role: "assistant", content: rawContent },
      ...(toolResults.length > 0
        ? [
            {
              role: "tool",
              content: toolResults.map((r) => `Tool "${r.name}" returned: ${JSON.stringify(r.result)}`).join("\n"),
            },
          ]
        : []),
      {
        role: "user",
        content:
          toolResults.length === 0
            ? "You listed steps but did not output any <tool_call> blocks. Output them now, one after another, in the same order as your steps. Use the exact format: <tool_call>{\"name\": \"create_agent\", \"arguments\": {...}}</tool_call> for each call. Do not add explanation, only the tool_call blocks."
            : `You listed ${expectedSteps} steps but only output ${toolResults.length} tool call(s). Output the REMAINING ${expectedSteps - toolResults.length} <tool_call> blocks now (steps ${toolResults.length + 1} through ${expectedSteps}). Use the same format. Only the missing tool_call blocks.`,
      },
    ];
    const nudgeResponse = await options.callLLM({
      messages: nudgeMessages,
      temperature: nudgeTemp,
    });
    const moreResults = await extractAndRunToolCalls(nudgeResponse.content, {
      startIndex: toolResults.length,
      todos: todos ?? [],
    });
    toolResults = [...toolResults, ...moreResults];
  }

  // Completed steps: first N todos map to first N tool results (order assumed)
  const completedStepIndices: number[] = [];
  if (todos && todos.length > 0 && toolResults.length > 0) {
    const n = Math.min(toolResults.length, todos.length);
    for (let i = 0; i < n; i++) completedStepIndices.push(i);
  }

  // Multi-round: if we got tool results, do follow-up; keep executing any new tool calls (e.g. update_agent after seeing get_agent/list_tools results)
  let content = effectiveAssistantContent;
  const maxRounds = 5;
  let round = 0;
  let lastAssistantContent = effectiveAssistantContent;
  let allToolResults = [...toolResults];

  while (toolResults.length > 0 && round < maxRounds) {
    // API requires: assistant message with tool_calls immediately followed by one tool message per call (each with tool_call_id).
    const syntheticToolCalls = toolResults.map((r, i) => ({
      id: `call_${round}_${i}`,
      name: r.name,
      arguments: typeof r.args === "string" ? r.args : JSON.stringify(r.args ?? {}),
    }));
    const assistantWithTools: LLMMessage = {
      role: "assistant",
      content: lastAssistantContent,
      toolCalls: syntheticToolCalls,
    };
    const toolMessages: LLMMessage[] = toolResults.map((r, i) => ({
      role: "tool" as const,
      content: typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? null),
      toolCallId: syntheticToolCalls[i].id,
    }));

    const followUpMessages: LLMMessage[] = [
      ...messages,
      assistantWithTools,
      ...toolMessages,
    ];

    const followUp = await options.callLLM({
      messages: followUpMessages,
      temperature: mainTemp,
    });

    lastAssistantContent = followUp.content;
    content = followUp.content;

    // Parse and execute any tool calls in the follow-up (e.g. update_agent with data from prior tool results)
    toolResults = await extractAndRunToolCalls(followUp.content, {
      startIndex: allToolResults.length,
      todos: todos ?? [],
    });
    for (let i = 0; i < toolResults.length; i++) {
      allToolResults.push(toolResults[i]);
      options.onProgress?.onToolDone?.(allToolResults.length - 1, toolResults[i].name, toolResults[i].result);
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
