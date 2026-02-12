import { json } from "../../_lib/response";
import {
  db,
  feedback,
  conversations,
  chatMessages,
  chatAssistantSettings,
  fromFeedbackRow,
  fromChatAssistantSettingsRow,
  fromLlmConfigRowWithSecret,
  llmConfigs,
} from "../../_lib/db";
import { eq, desc } from "drizzle-orm";
import { createDefaultLLMManager } from "@agentron-studio/runtime";
import { SYSTEM_PROMPT } from "@agentron-studio/runtime";

export const runtime = "nodejs";

export async function POST() {
  const configRows = (await db.select().from(llmConfigs)).map(fromLlmConfigRowWithSecret);
  if (configRows.length === 0) {
    return json({ error: "No LLM provider configured." }, { status: 400 });
  }
  const llmConfig = configRows.find((c) => (typeof c.extra?.apiKey === "string" && c.extra.apiKey.length > 0) || (typeof c.apiKeyRef === "string" && c.apiKeyRef.length > 0)) ?? configRows[0];

  const manager = createDefaultLLMManager(async (ref) => (ref ? process.env[ref] : undefined));

  const [fbRows, convRows, settingsRows] = await Promise.all([
    db.select().from(feedback).where(eq(feedback.targetType, "chat")).orderBy(desc(feedback.createdAt)).limit(20),
    db.select().from(conversations).orderBy(desc(conversations.createdAt)).limit(30),
    db.select().from(chatAssistantSettings).where(eq(chatAssistantSettings.id, "default")),
  ]);

  const feedbackItems = fbRows.map(fromFeedbackRow);
  const ratedConversations = convRows.filter((c) => c.rating != null && c.rating > 0);
  const currentPrompt = settingsRows.length > 0
    ? (fromChatAssistantSettingsRow(settingsRows[0]).customSystemPrompt ?? SYSTEM_PROMPT)
    : SYSTEM_PROMPT;

  const convDetails: { id: string; rating: number; note?: string; messages?: { role: string; content: string }[] }[] = [];
  for (const c of ratedConversations.slice(0, 10)) {
    const msgs = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, c.id)).orderBy(chatMessages.createdAt);
    convDetails.push({
      id: c.id,
      rating: c.rating ?? 0,
      note: c.note ?? undefined,
      messages: msgs.map((m) => ({ role: m.role, content: m.content.slice(0, 500) })),
    });
  }

  const feedbackBlock =
    feedbackItems.length > 0
      ? feedbackItems
          .map(
            (f) =>
              `[${f.label.toUpperCase()}] Input: ${(typeof f.input === "string" ? f.input : JSON.stringify(f.input)).slice(0, 300)}... Output: ${(typeof f.output === "string" ? f.output : JSON.stringify(f.output)).slice(0, 500)}...${f.notes ? ` Note: ${f.notes}` : ""}`
          )
          .join("\n")
      : "";
  const convBlock =
    convDetails.length > 0
      ? convDetails
          .map(
            (c) =>
              `[Rating: ${c.rating}/5${c.note ? `, Note: ${c.note}` : ""}]\n${(c.messages ?? []).map((m) => `${m.role}: ${m.content}`).join("\n")}`
          )
          .join("\n\n---\n\n")
      : "";

  const system = `You are helping improve the system prompt for an AI assistant in AgentOS Studio. The assistant helps users create and manage agents, workflows, and tools.

Given:
1. The current system prompt
2. User feedback (labeled good/bad examples)
3. Rated conversations (1-5 stars)

Output ONLY a revised system prompt that incorporates lessons from the feedback. Do not add commentary, markdown, or explanation. Output the complete prompt as plain text. If the feedback is insufficient or suggests no changes, output the current prompt unchanged.`;

  const user = `CURRENT PROMPT:
${currentPrompt.slice(0, 8000)}

---
USER FEEDBACK (good/bad examples):
${feedbackBlock || "(none)"}

---
RATED CONVERSATIONS:
${convBlock || "(none)"}

---
Output the improved system prompt (plain text only, no markdown):`;

  try {
    const res = await manager.chat(
      llmConfig as import("@agentron-studio/core").LLMConfig,
      { messages: [{ role: "user", content: user }], temperature: 0.3 }
    );
    const suggested = (res.content ?? "").trim();
    return json({ suggestedPrompt: suggested || currentPrompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, { status: 500 });
  }
}
