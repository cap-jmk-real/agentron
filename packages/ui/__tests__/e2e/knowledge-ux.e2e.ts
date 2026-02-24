/**
 * E2E: Knowledge UX — connector lastError on sync failure, bulk ingest (POST with collectionId).
 * Uses local embedding provider only (no cloud).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as embeddingProviderPost } from "../../app/api/rag/embedding-providers/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { POST as listConnectorsPost } from "../../app/api/rag/connectors/route";
import { GET as listConnectorsGet } from "../../app/api/rag/connectors/route";
import { POST as syncPost } from "../../app/api/rag/connectors/[id]/sync/route";
import { POST as ingestPost } from "../../app/api/rag/ingest/route";
import { e2eLog } from "./e2e-logger";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const E2E_EMBED_MODEL = process.env.E2E_EMBED_MODEL ?? "nomic-embed-text";
const E2E_EMBED_DIMENSIONS = 768;

describe("e2e knowledge-ux", () => {
  const start = Date.now();
  let collectionId: string;
  let errorConnectorId: string;

  beforeAll(() => {
    e2eLog.startTest("knowledge-ux");
    e2eLog.scenario("knowledge-ux", "lastError on connector card, bulk ingest");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("sync failure sets connector lastError and GET connectors returns it", async () => {
    const provRes = await embeddingProviderPost(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E UX local embed",
          type: "local",
          endpoint: OLLAMA_BASE_URL,
        }),
      })
    );
    expect(provRes.status).toBe(201);
    const provider = await provRes.json();

    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E UX enc",
          modelOrEndpoint: E2E_EMBED_MODEL,
          dimensions: E2E_EMBED_DIMENSIONS,
          embeddingProviderId: provider.id,
        }),
      })
    );
    const enc = await encRes.json();
    const storeRes = await storePost(
      new Request("http://localhost/api/rag/document-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E UX store",
          type: "local",
          bucket: "default",
        }),
      })
    );
    const store = await storeRes.json();
    const collRes = await collPost(
      new Request("http://localhost/api/rag/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E UX coll",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    collectionId = coll.id;

    const connRes = await listConnectorsPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId,
          config: { path: "" },
        }),
      })
    );
    expect(connRes.status).toBe(201);
    const conn = await connRes.json();
    errorConnectorId = conn.id;

    const syncRes = await syncPost(
      new Request(`http://localhost/api/rag/connectors/${errorConnectorId}/sync`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: errorConnectorId }) }
    );
    expect(syncRes.status).toBe(400);
    e2eLog.step("sync_failed", { connectorId: errorConnectorId });

    const listRes = await listConnectorsGet();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const connector = list.find((c: { id: string }) => c.id === errorConnectorId);
    expect(connector).toBeDefined();
    expect(connector.status).toBe("error");
    expect(connector.lastError).toBeDefined();
    expect(typeof connector.lastError).toBe("string");
    expect(connector.lastError.length).toBeGreaterThan(0);
    e2eLog.step("lastError_on_card", { lastError: connector.lastError.slice(0, 80) });
  });

  it("POST ingest with collectionId returns 200 and body with documents and chunks", async () => {
    const deploymentCollId = collectionId;
    const res = await ingestPost(
      new Request("http://localhost/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: deploymentCollId }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data).toHaveProperty("documents");
    expect(data).toHaveProperty("chunks");
    expect(typeof data.documents).toBe("number");
    expect(typeof data.chunks).toBe("number");
    e2eLog.step("bulk_ingest", { documents: data.documents, chunks: data.chunks });
  });
});
