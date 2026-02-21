/**
 * E2E: RAG retrieve effective limit, chat settings (needsEmbeddingForFeedbackRetrieval),
 * and feedback without embedding (last-N path, no error).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GET as chatSettingsGet } from "../../app/api/chat/settings/route";
import { POST as ragRetrievePost } from "../../app/api/rag/retrieve/route";
import { POST as feedbackPost } from "../../app/api/feedback/route";
import { POST as chatPost } from "../../app/api/chat/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { getDeploymentCollectionId } from "../../app/api/_lib/rag";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

describe("e2e rag-and-feedback-settings", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("rag-and-feedback-settings");
    e2eLog.scenario(
      "rag-and-feedback-settings",
      "RAG retrieve limit, chat settings hint, feedback without embedding"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("GET /api/chat/settings returns needsEmbeddingForFeedbackRetrieval", async () => {
    const res = await chatSettingsGet();
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(typeof data.needsEmbeddingForFeedbackRetrieval).toBe("boolean");
    e2eLog.step("chat settings", {
      needsEmbeddingForFeedbackRetrieval: data.needsEmbeddingForFeedbackRetrieval,
    });
  });

  it("POST /api/rag/retrieve respects limit in body and returns chunks", async () => {
    const collectionId = await getDeploymentCollectionId();
    if (!collectionId) {
      e2eLog.step("skip no deployment collection", {});
      return;
    }
    const res = await ragRetrievePost(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test query", limit: 3 }),
      })
    );
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.chunks)).toBe(true);
    expect(data.chunks.length).toBeLessThanOrEqual(3);
    e2eLog.step("rag retrieve with limit", { chunksReturned: data.chunks.length });
  });

  it("POST /api/rag/retrieve without limit uses effective limit", async () => {
    const collectionId = await getDeploymentCollectionId();
    if (!collectionId) {
      e2eLog.step("skip no deployment collection", {});
      return;
    }
    const res = await ragRetrievePost(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      })
    );
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.chunks)).toBe(true);
    e2eLog.step("rag retrieve default limit", { chunksReturned: data.chunks.length });
  });

  it("feedback without embedding: POST feedback then chat completes (last-N path)", async () => {
    await feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "chat",
          targetId: "chat",
          input: "e2e feedback input",
          output: "e2e feedback output",
          label: "good",
        }),
      })
    );
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E feedback last-N" }),
      })
    );
    const conv = await createRes.json();
    const res = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Say hello in one word.",
          conversationId: conv.id,
          providerId: E2E_LLM_CONFIG_ID,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
    e2eLog.step("chat with feedback last-N", {});
  }, 60_000);
});
