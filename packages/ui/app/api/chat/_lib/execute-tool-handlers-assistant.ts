/**
 * Tool handlers for assistant memory and settings: answer_question, explain_software, remember, get_assistant_setting, set_assistant_setting.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import {
  db,
  assistantMemory,
  chatAssistantSettings,
  toAssistantMemoryRow,
  fromChatAssistantSettingsRow,
  toChatAssistantSettingsRow,
} from "../../_lib/db";
import { eq } from "drizzle-orm";

const DEFAULT_RECENT_SUMMARIES_COUNT = 3;
const MIN_SUMMARIES = 1;
const MAX_SUMMARIES = 10;

export const ASSISTANT_TOOL_NAMES = [
  "answer_question",
  "explain_software",
  "remember",
  "get_assistant_setting",
  "set_assistant_setting",
] as const;

export async function handleAssistantTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "answer_question": {
      const question =
        typeof a.question === "string"
          ? a.question.trim()
          : a.question != null
            ? String(a.question).trim()
            : "";
      return {
        message: "Answering general question",
        question: question || "(no question provided)",
      };
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
        if (Number.isNaN(value)) value = DEFAULT_RECENT_SUMMARIES_COUNT;
      } else {
        value = Math.round(value);
      }
      if (Number.isNaN(value)) value = DEFAULT_RECENT_SUMMARIES_COUNT;
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
    default:
      return undefined;
  }
}
