import type { NodeAgentDefinition, AgentExecutionContext, PromptTemplate, ToolOverride } from "@agentron-studio/core";
import { renderPromptTemplate, validatePromptArguments } from "../prompts";
import type { LLMRequest, LLMResponse, LLMMessage } from "../llm/types";

type NodeExecutionContext = AgentExecutionContext & {
  prompts?: Record<string, PromptTemplate>;
};

/** Runs the LLM with a decision layer: when tools are available, the model may return tool_calls; we execute them and loop until a final text response. */
async function runLLMWithDecisionLayer(
  context: NodeExecutionContext,
  request: LLMRequest & { llmConfigId?: string }
): Promise<string> {
  let messages: LLMMessage[] = [...request.messages];
  const tools = request.tools;

  for (let round = 0; round < 20; round++) {
    const req = { ...request, messages, llmConfigId: request.llmConfigId };
    const raw = await context.callLLM(req);
    const res = raw as LLMResponse;
    if (!isLLMResponse(res)) return typeof raw === "string" ? raw : String(raw ?? "");

    if (!res.toolCalls || res.toolCalls.length === 0) {
      return res.content ?? "";
    }

    messages = [
      ...messages,
      { role: "assistant" as const, content: res.content ?? "", toolCalls: res.toolCalls },
    ];
    for (const tc of res.toolCalls) {
      let args: unknown;
      try {
        args = JSON.parse(tc.arguments ?? "{}");
      } catch {
        args = {};
      }
      const result = await context.callTool(tc.name, args);
      const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
      messages.push({ role: "tool" as const, content, toolCallId: tc.id });
    }
  }
  return (messages[messages.length - 1]?.content as string) ?? "";
}

function isLLMResponse(v: unknown): v is LLMResponse {
  return v != null && typeof v === "object" && "content" in (v as object);
}

/** Apply transform: {{ $input }} is replaced with JSON.stringify(value). Passthrough if no expression. */
function applyTransform(config: Record<string, unknown> | undefined, value: unknown): unknown {
  const expr = config?.transform && typeof (config.transform as { expression?: string }).expression === "string"
    ? (config.transform as { expression: string }).expression
    : typeof config?.expression === "string"
      ? config.expression
      : undefined;
  if (!expr || !expr.trim()) return value;
  const inputStr = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const result = expr.replace(/\{\{\s*\$input\s*\}\}/g, inputStr);
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}

export class NodeAgentExecutor {
  async execute(
    definition: NodeAgentDefinition,
    input: unknown,
    context: NodeExecutionContext
  ): Promise<unknown> {
    let lastOutput: unknown = input;
    const shared = context.sharedContext ?? {};

    const nodes = definition.graph?.nodes ?? [];
    for (const node of nodes) {
      const p = node.parameters ?? {};
      switch (node.type) {
        case "prompt": {
          const promptId = String(p.promptId ?? "");
          const prompt = context.prompts?.[promptId];
          if (!prompt) {
            throw new Error(`Prompt not found: ${promptId}`);
          }
          const args = (p.args as Record<string, unknown>) ?? {};
          validatePromptArguments(prompt, args);
          const rendered = renderPromptTemplate(prompt, { input: lastOutput, context: shared, args });
          const llmConfigId = (p.llmConfigId as string) ?? definition.defaultLlmConfigId;
          const raw = await context.callLLM({ llmConfigId, messages: [{ role: "user", content: rendered }] });
          lastOutput = (raw && typeof raw === "object" && "content" in (raw as object)) ? (raw as { content: string }).content : raw;
          break;
        }
        case "llm": {
          const llmConfigId = (p.llmConfigId as string) ?? definition.defaultLlmConfigId;
          const systemPrompt = String(p.systemPrompt ?? "").trim();
          let userContent = typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput ?? "");
          const ragBlock = context.ragBlock ?? "";
          const toolInstructionsBlock = context.toolInstructionsBlock ?? "";
          if (ragBlock || toolInstructionsBlock) {
            userContent = [ragBlock, toolInstructionsBlock].filter(Boolean).join("\n\n") + (userContent ? "\n\n" + userContent : "");
          }
          const tools = (definition.toolIds ?? []).length > 0 ? context.availableTools : undefined;
          lastOutput = await runLLMWithDecisionLayer(context, {
            llmConfigId,
            messages: [
              ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
              { role: "user" as const, content: userContent },
            ],
            ...(tools && tools.length > 0 ? { tools } : {}),
          });
          break;
        }
        case "decision": {
          const llmConfigId = (p.llmConfigId as string) ?? definition.defaultLlmConfigId;
          if (!llmConfigId) throw new Error(`Decision node "${node.id}" requires llmConfigId or agent defaultLlmConfigId`);
          const nodeToolIds = (Array.isArray(p.toolIds) ? p.toolIds : definition.toolIds ?? []) as string[];
          const tools = context.buildToolsForIds
            ? await context.buildToolsForIds(nodeToolIds)
            : (nodeToolIds.length > 0 && context.availableTools ? context.availableTools : undefined);
          const systemPrompt = String(p.systemPrompt ?? "").trim();
          let userContent = typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput ?? "");
          const ragBlock = context.ragBlock ?? "";
          const toolInstructionsBlock = context.toolInstructionsBlock ?? "";
          if (ragBlock || toolInstructionsBlock) {
            userContent = [ragBlock, toolInstructionsBlock].filter(Boolean).join("\n\n") + (userContent ? "\n\n" + userContent : "");
          }
          lastOutput = await runLLMWithDecisionLayer(context, {
            llmConfigId,
            messages: [
              ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
              { role: "user" as const, content: userContent },
            ],
            ...(tools && tools.length > 0 ? { tools } : {}),
          });
          break;
        }
        case "tool": {
          const toolId = String(p.toolId ?? "");
          const override = p.override as ToolOverride | undefined;
          lastOutput = await context.callTool(toolId, p.input ?? lastOutput, override);
          break;
        }
        case "context_read": {
          const key = String(p.key ?? "");
          lastOutput = shared[key];
          break;
        }
        case "context_write": {
          const key = String(p.key ?? "");
          shared[key] = p.value ?? lastOutput;
          break;
        }
        case "input": {
          lastOutput = applyTransform(p, input);
          break;
        }
        case "output": {
          lastOutput = applyTransform(p, lastOutput);
          break;
        }
        default:
          lastOutput = lastOutput;
      }
    }

    return lastOutput;
  }
}
