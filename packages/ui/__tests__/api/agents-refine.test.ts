import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as agentRefinePost } from "../../app/api/agents/[id]/refine/route";
import { db, agents, feedback, llmConfigs } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

const mockRefinePrompt = vi.fn();
const mockChat = vi.fn();
vi.mock("@agentron-studio/runtime", () => ({
  refinePrompt: (...args: unknown[]) => mockRefinePrompt(...args),
  createDefaultLLMManager: () => ({
    chat: (...args: unknown[]) => mockChat(...args),
  }),
}));

describe("POST /api/agents/:id/refine", () => {
  let agentId: string;
  let savedLlmConfigs: { id: string }[] = [];

  beforeEach(async () => {
    mockRefinePrompt.mockReset();
    mockChat.mockReset();
    agentId = "refine-agent-" + Date.now();
    await db
      .insert(agents)
      .values({
        id: agentId,
        name: "Refine Test Agent",
        kind: "node",
        type: "internal",
        protocol: "native",
        capabilities: "[]",
        scopes: "[]",
        llmConfig: null,
        definition: JSON.stringify({ systemPrompt: "You are helpful.", steps: [] }),
        createdAt: Date.now(),
      })
      .run();
    await db
      .insert(feedback)
      .values({
        id: "fb-refine-" + Date.now(),
        targetType: "agent",
        targetId: agentId,
        input: "user said this",
        output: "agent said that",
        label: "good",
        notes: null,
        createdAt: Date.now(),
      })
      .run();
  });

  afterEach(async () => {
    if (agentId) {
      await db.delete(feedback).where(eq(feedback.targetId, agentId)).run();
      await db.delete(agents).where(eq(agents.id, agentId)).run();
    }
  });

  it("returns 400 when no LLM configured globally and agent has no llmConfig", async () => {
    const rows = await db.select({ id: llmConfigs.id }).from(llmConfigs);
    savedLlmConfigs = rows;
    for (const r of rows) {
      await db.delete(llmConfigs).where(eq(llmConfigs.id, r.id)).run();
    }
    try {
      const res = await agentRefinePost(
        new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
        { params: Promise.resolve({ id: agentId }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("No LLM configured");
    } finally {
      for (const r of savedLlmConfigs) {
        await db
          .insert(llmConfigs)
          .values({
            id: r.id,
            provider: "openai",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
            apiKeyRef: null,
            extra: null,
          })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  it("returns 200 and refined result when agent has no llmConfig but global config exists", async () => {
    let configs = await db.select().from(llmConfigs);
    if (configs.length === 0) {
      await db
        .insert(llmConfigs)
        .values({
          id: "refine-global-config-" + Date.now(),
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          apiKeyRef: null,
          extra: null,
        })
        .run();
    }
    mockRefinePrompt.mockResolvedValue({
      systemPrompt: "Refined system prompt",
      steps: [{ name: "Step", type: "step", content: "Content" }],
    });
    const res = await agentRefinePost(
      new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
      { params: Promise.resolve({ id: agentId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.systemPrompt).toBe("Refined system prompt");
    expect(mockRefinePrompt).toHaveBeenCalled();
  });

  it("returns 200 when agent has no llmConfig and definition has no systemPrompt or steps", async () => {
    await db
      .update(agents)
      .set({ definition: JSON.stringify({}) })
      .where(eq(agents.id, agentId))
      .run();
    let configs = await db.select().from(llmConfigs);
    if (configs.length === 0) {
      await db
        .insert(llmConfigs)
        .values({
          id: "refine-empty-def-" + Date.now(),
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          apiKeyRef: null,
          extra: null,
        })
        .run();
    }
    mockRefinePrompt.mockResolvedValue({
      systemPrompt: "Refined from empty",
      steps: [],
    });
    const res = await agentRefinePost(
      new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
      { params: Promise.resolve({ id: agentId }) }
    );
    expect(res.status).toBe(200);
    expect(mockRefinePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSystemPrompt: "",
        currentSteps: undefined,
      }),
      expect.any(Function)
    );
  });

  it("returns 200 and refined result when agent has llmConfig", async () => {
    const cfgId = "refine-agent-cfg-" + Date.now();
    await db
      .insert(llmConfigs)
      .values({
        id: cfgId,
        provider: "openai",
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
        apiKeyRef: null,
        extra: null,
      })
      .run();
    await db
      .update(agents)
      .set({
        llmConfig: JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
        }),
      })
      .where(eq(agents.id, agentId))
      .run();
    mockRefinePrompt.mockResolvedValue({
      systemPrompt: "Refined with agent config",
      steps: [],
    });
    const res = await agentRefinePost(
      new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
      { params: Promise.resolve({ id: agentId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.systemPrompt).toBe("Refined with agent config");
    expect(mockRefinePrompt).toHaveBeenCalled();
    await db.delete(llmConfigs).where(eq(llmConfigs.id, cfgId)).run();
  });

  it("returns 200 when agent has llmConfig and definition is empty (branches 59-62)", async () => {
    const cfgId = "refine-cfg-empty-" + Date.now();
    await db
      .insert(llmConfigs)
      .values({
        id: cfgId,
        provider: "openai",
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
        apiKeyRef: null,
        extra: null,
      })
      .run();
    await db
      .update(agents)
      .set({
        llmConfig: JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
        }),
        definition: JSON.stringify({}),
      })
      .where(eq(agents.id, agentId))
      .run();
    mockRefinePrompt.mockResolvedValue({
      systemPrompt: "From empty def",
      steps: undefined,
    });
    const res = await agentRefinePost(
      new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
      { params: Promise.resolve({ id: agentId }) }
    );
    expect(res.status).toBe(200);
    expect(mockRefinePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSystemPrompt: "",
        currentSteps: undefined,
      }),
      expect.any(Function)
    );
    await db.delete(llmConfigs).where(eq(llmConfigs.id, cfgId)).run();
  });
});
