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

/** Topological sort by graph edges. Returns node ids in execution order. Entry nodes (no incoming edges) first. Falls back to array order when no edges. */
function topologicalOrder(
  nodes: { id: string }[],
  edges: { source?: string; target?: string; from?: string; to?: string }[]
): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outEdges.set(id, []);
  }
  for (const e of edges) {
    const from = e.source ?? e.from ?? "";
    const to = e.target ?? e.to ?? "";
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    outEdges.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of inDegree) {
    if (d === 0) queue.push(id);
  }
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const to of outEdges.get(id) ?? []) {
      const d = (inDegree.get(to) ?? 1) - 1;
      inDegree.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  if (order.length < nodeIds.size) {
    const missing = [...nodeIds].filter((id) => !order.includes(id));
    order.push(...missing);
  }
  return order;
}

/** Resolve input for a node: from predecessor(s) or agent input. With multiple predecessors, use the last one by topological order. */
function resolveNodeInput(
  nodeId: string,
  order: string[],
  outputs: Map<string, unknown>,
  edges: { source?: string; target?: string; from?: string; to?: string }[],
  agentInput: unknown
): unknown {
  const predecessors: string[] = [];
  for (const e of edges) {
    const from = e.source ?? e.from ?? "";
    const to = e.target ?? e.to ?? "";
    if (to === nodeId && from) predecessors.push(from);
  }
  if (predecessors.length === 0) return agentInput;
  const lastPred = predecessors.sort((a, b) => order.indexOf(a) - order.indexOf(b)).pop();
  return lastPred != null && outputs.has(lastPred) ? outputs.get(lastPred) : agentInput;
}

export class NodeAgentExecutor {
  async execute(
    definition: NodeAgentDefinition,
    input: unknown,
    context: NodeExecutionContext
  ): Promise<unknown> {
    const shared = context.sharedContext ?? {};
    const nodes = definition.graph?.nodes ?? [];
    const edges = Array.isArray(definition.graph?.edges) ? definition.graph.edges : [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const outputs = new Map<string, unknown>();

    const order = edges.length > 0 ? topologicalOrder(nodes, edges) : nodes.map((n) => n.id);

    for (const nodeId of order) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const lastOutput = resolveNodeInput(nodeId, order, outputs, edges, input);
      const p = node.parameters ?? {};
      let out: unknown;
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
          out = (raw && typeof raw === "object" && "content" in (raw as object)) ? (raw as { content: string }).content : raw;
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
          out = await runLLMWithDecisionLayer(context, {
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
          out = await runLLMWithDecisionLayer(context, {
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
          const toolId = String((p as { toolId?: string }).toolId ?? p.toolId ?? "");
          const override = p.override as ToolOverride | undefined;
          const toolIds = (definition.toolIds ?? []) as string[];
          // Tool nodes connected from LLM/decision represent "this node can call these tools".
          // The LLM/decision already invokes them; do not re-invoke with LLM text output.
          const predecessors: string[] = [];
          for (const e of edges) {
            const from = e.source ?? e.from ?? "";
            const to = e.target ?? e.to ?? "";
            if (to === nodeId && from) predecessors.push(from);
          }
          const predId = predecessors.sort((a, b) => order.indexOf(a) - order.indexOf(b)).pop();
          const predNode = predId ? nodeMap.get(predId) : undefined;
          const predIsLlmOrDecision = predNode?.type === "llm" || predNode?.type === "decision";
          const toolIsLlmDeclared = toolIds.includes(toolId) && predIsLlmOrDecision;
          if (toolIsLlmDeclared) {
            // Pass through: the LLM/decision already called this tool; its output is the final result
            out = lastOutput;
          } else {
            out = await context.callTool(toolId, p.input ?? lastOutput, override);
          }
          break;
        }
        case "context_read": {
          const key = String(p.key ?? "");
          out = shared[key];
          break;
        }
        case "context_write": {
          const key = String(p.key ?? "");
          shared[key] = p.value ?? lastOutput;
          out = lastOutput;
          break;
        }
        case "input": {
          out = applyTransform(p, input);
          break;
        }
        case "output": {
          out = applyTransform(p, lastOutput);
          break;
        }
        default:
          out = lastOutput;
      }
      outputs.set(nodeId, out);
    }

    return order.length > 0 && outputs.has(order[order.length - 1]!)
      ? outputs.get(order[order.length - 1]!)
      : input;
  }
}
