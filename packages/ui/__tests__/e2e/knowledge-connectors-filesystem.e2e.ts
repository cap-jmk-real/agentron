/**
 * E2E: Knowledge connectors (filesystem) — add deployment collection, filesystem connector,
 * sync, then in heap chat list_connectors and list_connector_items.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as embeddingProviderPost } from "../../app/api/rag/embedding-providers/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { POST as listConnectorsPost } from "../../app/api/rag/connectors/route";
import { POST as syncPost } from "../../app/api/rag/connectors/[id]/sync/route";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const E2E_EMBED_MODEL = process.env.E2E_EMBED_MODEL ?? "nomic-embed-text";
const E2E_EMBED_DIMENSIONS = 768;

async function readEventStream(
  turnId: string
): Promise<
  { type?: string; toolResults?: { name: string; result?: unknown }[]; content?: string }[]
> {
  const res = await getChatEvents(
    new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
  );
  if (!res.ok || !res.body) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value);
    if (done) break;
  }
  reader.releaseLock();
  const events: { type?: string; toolResults?: { name: string; result?: unknown }[] }[] = [];
  for (const chunk of buffer.split("\n\n").filter((s) => s.trim())) {
    const m = chunk.match(/^data:\s*(.+)$/m);
    if (m) {
      try {
        events.push(JSON.parse(m[1].trim()));
      } catch {
        // skip
      }
    }
  }
  return events;
}

describe("e2e knowledge-connectors-filesystem", () => {
  const start = Date.now();
  let tmpDir: string;
  let collectionId: string;
  let connectorId: string;
  /** When true, Ollama has the embed model and chat will not fail on retrieveChunks. */
  let embedAvailable = false;

  beforeAll(() => {
    e2eLog.startTest("knowledge-connectors-filesystem");
    e2eLog.scenario(
      "knowledge-connectors-filesystem",
      "Add filesystem connector, sync, list_connectors and list_connector_items in heap chat"
    );
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("creates deployment collection, temp dir with .md files, and filesystem connector", async () => {
    tmpDir = path.resolve(path.join(os.tmpdir(), `e2e-knowledge-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "# E2E Knowledge\n\nSync test.");
    fs.writeFileSync(path.join(tmpDir, "note.md"), "# Note\n\nContent for list items.");
    e2eLog.step("temp_dir", { path: tmpDir });

    const provRes = await embeddingProviderPost(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E local embed",
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
          name: "E2E enc",
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
          name: "E2E store",
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
          name: "E2E deployment",
          scope: "deployment",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    collectionId = coll.id;
    e2eLog.step("deployment_collection", { collectionId });

    const connRes = await listConnectorsPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId,
          config: { path: tmpDir, ingestAfterSync: true },
        }),
      })
    );
    expect(connRes.status).toBe(201);
    const conn = await connRes.json();
    connectorId = conn.id;
    e2eLog.step("filesystem_connector", { connectorId });
  });

  it("syncs connector and gets documents", async () => {
    const syncRes = await syncPost(
      new Request(`http://localhost/api/rag/connectors/${connectorId}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id: connectorId }) }
    );
    expect(syncRes.status).toBe(200);
    const data = await syncRes.json();
    expect(data.ok).toBe(true);
    expect(data.synced).toBeGreaterThanOrEqual(1);
    expect(data.total).toBeGreaterThanOrEqual(1);
    e2eLog.step("sync", { synced: data.synced, total: data.total });
  });

  it("checks Ollama embed model available for chat (skip heap chat tests if not)", async () => {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: E2E_EMBED_MODEL, input: "test" }),
      });
      embedAvailable = res.ok;
      if (!embedAvailable) e2eLog.step("embed_skip", { reason: "Ollama embed model not found" });
    } catch {
      embedAvailable = false;
      e2eLog.step("embed_skip", { reason: "Ollama unreachable" });
    }
  });

  it("heap chat list my connectors returns list_connectors with connector", async () => {
    if (!embedAvailable) {
      e2eLog.step("skip_chat", { reason: "embed model not available" });
      return;
    }
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E Knowledge connectors" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;

    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "List my connectors. Reply with the connector ids you see.",
          conversationId,
          providerId: E2E_LLM_CONFIG_ID,
          useHeapMode: true,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;

    const events = await readEventStream(turnId);
    const doneEvent = events.find((e) => e?.type === "done");
    expect(doneEvent).toBeDefined();
    const toolResults =
      (doneEvent as { toolResults?: { name: string; result?: unknown }[] } | undefined)
        ?.toolResults ?? [];
    const listConnectorsResult = toolResults.find((r) => r.name === "list_connectors");
    expect(listConnectorsResult).toBeDefined();
    const connectors = listConnectorsResult?.result as { id?: string; type?: string }[] | undefined;
    expect(Array.isArray(connectors)).toBe(true);
    const ourConnector = connectors?.find((c) => c.id === connectorId);
    expect(ourConnector).toBeDefined();
    expect(ourConnector?.type).toBe("filesystem");
    e2eLog.toolCall("list_connectors", JSON.stringify(connectors).slice(0, 200));
  }, 120_000);

  it("heap chat list items in filesystem connector returns list_connector_items", async () => {
    if (!embedAvailable) {
      e2eLog.step("skip_chat", { reason: "embed model not available" });
      return;
    }
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E Knowledge list items" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;

    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: `List items in the connector with id ${connectorId}. Use list_connector_items.`,
          conversationId,
          providerId: E2E_LLM_CONFIG_ID,
          useHeapMode: true,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;

    const events = await readEventStream(turnId);
    const doneEvent = events.find((e) => e?.type === "done");
    expect(doneEvent).toBeDefined();
    const toolResults =
      (doneEvent as { toolResults?: { name: string; result?: unknown }[] } | undefined)
        ?.toolResults ?? [];
    const listItemsResult = toolResults.find((r) => r.name === "list_connector_items");
    expect(listItemsResult).toBeDefined();
    const items = listItemsResult?.result as
      | { items?: { id?: string; name?: string }[] }
      | undefined;
    expect(items).toBeDefined();
    const itemList = Array.isArray(items) ? items : ((items as { items?: unknown[] })?.items ?? []);
    expect(itemList.length).toBeGreaterThanOrEqual(1);
    e2eLog.toolCall("list_connector_items", JSON.stringify(itemList).slice(0, 200));
  }, 120_000);
});
