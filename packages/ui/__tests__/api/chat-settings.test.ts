import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { GET, PATCH } from "../../app/api/chat/settings/route";
import { db } from "../../app/api/_lib/db";

describe("Chat settings API", () => {
  it("GET /api/chat/settings returns default when no row exists", async () => {
    let selectCallCount = 0;
    const spy = vi.spyOn(db, "select").mockImplementation(((..._args: unknown[]) => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([]) }) } as unknown as ReturnType<
          typeof db.select
        >;
      }
      return {
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      } as unknown as ReturnType<typeof db.select>;
    }) as typeof db.select);
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("default");
      expect(data.customSystemPrompt).toBeNull();
      expect(data.recentSummariesCount).toBe(3);
      expect(data.temperature).toBe(0.7);
      expect(data.historyCompressAfter).toBe(24);
      expect(data.historyKeepRecent).toBe(16);
      expect(data.plannerRecentMessages).toBe(12);
      expect(data.needsEmbeddingForFeedbackRetrieval).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("GET /api/chat/settings returns needsEmbedding true when deployment collection has no encodingConfigId", async () => {
    let selectCallCount = 0;
    const spy = vi.spyOn(db, "select").mockImplementation(((..._args: unknown[]) => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([]) }) } as unknown as ReturnType<
          typeof db.select
        >;
      }
      if (selectCallCount === 2) {
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ id: "deploy-collection-1" }]) }),
          }),
        } as unknown as ReturnType<typeof db.select>;
      }
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ encodingConfigId: null }]) }),
        }),
      } as unknown as ReturnType<typeof db.select>;
    }) as typeof db.select);
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.needsEmbeddingForFeedbackRetrieval).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("GET /api/chat/settings returns default or saved settings", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("default");
    expect(data).toHaveProperty("customSystemPrompt");
    expect(data).toHaveProperty("temperature");
    expect(data).toHaveProperty("historyCompressAfter");
    expect(data).toHaveProperty("historyKeepRecent");
    expect(data).toHaveProperty("plannerRecentMessages");
    expect(
      typeof data.plannerRecentMessages === "number" || data.plannerRecentMessages === null
    ).toBe(true);
  });

  it("GET /api/chat/settings returns needsEmbedding false when deployment collection has encodingConfigId", async () => {
    let selectCallCount = 0;
    const spy = vi.spyOn(db, "select").mockImplementation(((..._args: unknown[]) => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ id: "default" }]) }),
        } as unknown as ReturnType<typeof db.select>;
      }
      if (selectCallCount === 2) {
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ id: "deploy-collection-1" }]) }),
          }),
        } as unknown as ReturnType<typeof db.select>;
      }
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ encodingConfigId: "enc-1" }]) }),
        }),
      } as unknown as ReturnType<typeof db.select>;
    }) as typeof db.select);
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.needsEmbeddingForFeedbackRetrieval).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("PATCH /api/chat/settings updates settings", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: "You are helpful.", temperature: 0.5 }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.customSystemPrompt).toBe("You are helpful.");
    expect(data.temperature).toBe(0.5);
  });

  it("PATCH /api/chat/settings accepts context ids and numeric options", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextAgentIds: ["a1", "a2"],
          contextWorkflowIds: ["w1"],
          contextToolIds: [],
          recentSummariesCount: 5,
          historyCompressAfter: 50,
          historyKeepRecent: 20,
          plannerRecentMessages: 15,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recentSummariesCount).toBe(5);
    expect(data.historyCompressAfter).toBe(50);
    expect(data.historyKeepRecent).toBe(20);
    expect(data.plannerRecentMessages).toBe(15);
  });

  it("PATCH /api/chat/settings accepts contextToolIds array and filters to strings", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextToolIds: ["tool-1", "tool-2", 123, null],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.contextToolIds).toEqual(["tool-1", "tool-2"]);
  });

  it("PATCH /api/chat/settings with invalid JSON returns 200 with existing state", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("id", "default");
  });

  it("PATCH /api/chat/settings uses default when recentSummariesCount is NaN", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recentSummariesCount: "not-a-number" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recentSummariesCount).toBe(3);
  });

  it("PATCH /api/chat/settings uses default when temperature is NaN", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperature: "not-a-number" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.temperature).toBe(0.7);
  });

  it("PATCH /api/chat/settings uses defaults when historyCompressAfter, historyKeepRecent, plannerRecentMessages are NaN", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyCompressAfter: "nope",
          historyKeepRecent: "nope",
          plannerRecentMessages: "nope",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historyCompressAfter).toBe(24);
    expect(data.historyKeepRecent).toBe(16);
    expect(data.plannerRecentMessages).toBe(12);
  });

  it("PATCH /api/chat/settings clamps historyCompressAfter and historyKeepRecent", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyCompressAfter: 5,
          historyKeepRecent: 200,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historyCompressAfter).toBe(10);
    expect(data.historyKeepRecent).toBe(100);
  });

  it("PATCH /api/chat/settings clamps plannerRecentMessages to 1-100", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannerRecentMessages: 0 }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plannerRecentMessages).toBe(1);
  });

  it("PATCH /api/chat/settings clears customSystemPrompt when null or empty string", async () => {
    await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: "Temporary" }),
      })
    );
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: null }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.customSystemPrompt).toBeNull();
    const res2 = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: "" }),
      })
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.customSystemPrompt).toBeNull();
  });

  it("PATCH /api/chat/settings with new row uses historyKeepRecent and plannerRecentMessages", async () => {
    const { chatAssistantSettings } = await import("../../app/api/_lib/db");
    await db.delete(chatAssistantSettings).where(eq(chatAssistantSettings.id, "default")).run();
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyKeepRecent: 10,
          plannerRecentMessages: 8,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historyKeepRecent).toBe(10);
    expect(data.plannerRecentMessages).toBe(8);
  });
});
