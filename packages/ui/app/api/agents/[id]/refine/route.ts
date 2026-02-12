import { json } from "../../../_lib/response";
import { db, agents, feedback, llmConfigs, fromAgentRow, fromFeedbackRow, fromLlmConfigRowWithSecret } from "../../../_lib/db";
import { eq } from "drizzle-orm";
import type { LLMConfig } from "@agentron-studio/core";
import { refinePrompt, createDefaultLLMManager } from "@agentron-studio/runtime";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  // Load agent
  const agentRows = await db.select().from(agents).where(eq(agents.id, id));
  if (agentRows.length === 0) return json({ error: "Agent not found" }, { status: 404 });
  const agent = fromAgentRow(agentRows[0]);

  // Load feedback
  const fbRows = await db.select().from(feedback).where(eq(feedback.targetId, id));
  const items = fbRows.map(fromFeedbackRow);

  if (items.length === 0) {
    return json({ error: "No feedback to refine from" }, { status: 400 });
  }

  // Get LLM config
  const llmConfig = agent.llmConfig;
  if (!llmConfig) {
    // Try first available config
    const configs = await db.select().from(llmConfigs);
    if (configs.length === 0) {
      return json({ error: "No LLM configured for this agent or globally" }, { status: 400 });
    }
    const cfg = fromLlmConfigRowWithSecret(configs[0]);
    const manager = createDefaultLLMManager(async (ref) => ref ? process.env[ref] : undefined);

    const definition = (agent as { definition?: Record<string, unknown> }).definition ?? {};
    const result = await refinePrompt(
      {
        currentSystemPrompt: (definition as { systemPrompt?: string }).systemPrompt ?? "",
        currentSteps: (definition as { steps?: { name: string; type: string; content: string }[] }).steps,
        feedback: items,
      },
      (req) => manager.chat(cfg as LLMConfig, req, { source: "agent", agentId: id })
    );
    return json(result);
  }

  const manager = createDefaultLLMManager(async (ref) => ref ? process.env[ref] : undefined);
  const definition = (agent as { definition?: Record<string, unknown> }).definition ?? {};
  const result = await refinePrompt(
    {
      currentSystemPrompt: (definition as { systemPrompt?: string }).systemPrompt ?? "",
      currentSteps: (definition as { steps?: { name: string; type: string; content: string }[] }).steps,
      feedback: items,
    },
    (req) => manager.chat(llmConfig as LLMConfig, req, { source: "agent", agentId: id })
  );
  return json(result);
}
