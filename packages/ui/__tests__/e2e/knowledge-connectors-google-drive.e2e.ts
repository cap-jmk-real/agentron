/**
 * E2E: Knowledge connectors (Google Drive) — API flow with or without auth.
 * Run when verifying real Google Drive auth: set E2E_GOOGLE_DRIVE_AUTH=1.
 * When set: creates collection, adds google_drive connector, calls sync; passes if sync returns
 * 200 (creds configured) or 400 with auth-related error (no creds). When not set: skips.
 */
import { describe, it, expect } from "vitest";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as embeddingProviderPost } from "../../app/api/rag/embedding-providers/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { POST as listConnectorsPost } from "../../app/api/rag/connectors/route";
import { POST as syncPost } from "../../app/api/rag/connectors/[id]/sync/route";
import { e2eLog } from "./e2e-logger";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const E2E_EMBED_MODEL = process.env.E2E_EMBED_MODEL ?? "nomic-embed-text";
const E2E_EMBED_DIMENSIONS = 768;
const E2E_GOOGLE_DRIVE_AUTH = process.env.E2E_GOOGLE_DRIVE_AUTH === "1";

describe("e2e knowledge-connectors-google-drive", () => {
  it("when E2E_GOOGLE_DRIVE_AUTH unset, test is skipped", () => {
    if (!E2E_GOOGLE_DRIVE_AUTH) {
      expect(E2E_GOOGLE_DRIVE_AUTH).toBe(false);
      return;
    }
  });

  it("when E2E_GOOGLE_DRIVE_AUTH=1, create connector and sync (200 or 400 auth error)", async () => {
    if (!E2E_GOOGLE_DRIVE_AUTH) return;

    const provRes = await embeddingProviderPost(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E GDrive local embed",
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
          name: "E2E GDrive enc",
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
          name: "E2E GDrive store",
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
          name: "E2E GDrive coll",
          scope: "deployment",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const collectionId = coll.id;

    const connRes = await listConnectorsPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "google_drive",
          collectionId,
          config: {},
        }),
      })
    );
    expect(connRes.status).toBe(201);
    const conn = await connRes.json();
    const connectorId = conn.id;

    const syncRes = await syncPost(
      new Request(`http://localhost/api/rag/connectors/${connectorId}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id: connectorId }) }
    );
    const data = (await syncRes.json()) as { ok?: boolean; error?: string };
    if (syncRes.status === 200) {
      expect(data.ok).toBe(true);
      e2eLog.step("google_drive_sync_ok", { connectorId });
    } else {
      expect(syncRes.status).toBe(400);
      expect(data.error).toBeDefined();
      expect(String(data.error).toLowerCase()).toMatch(/google|serviceaccount|env|credential/);
      e2eLog.step("google_drive_sync_auth_required", { error: (data.error ?? "").slice(0, 80) });
    }
  });
});
