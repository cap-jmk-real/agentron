import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  readConnectorItem,
  updateConnectorItem,
} from "../../app/api/rag/connectors/_lib/connector-write";
import { db } from "../../app/api/_lib/db";
import { ragConnectors } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

describe("connector-write", () => {
  it("readConnectorItem returns error when connector not found", async () => {
    const result = await readConnectorItem("non-existent-id", "/any/path");
    expect(result).toEqual({ error: "Connector not found" });
  });

  it("updateConnectorItem returns error when connector not found", async () => {
    const result = await updateConnectorItem("non-existent-id", "/any/path", "content");
    expect(result).toEqual({ error: "Connector not found" });
  });

  it("readConnectorItem and updateConnectorItem work for filesystem connector", async () => {
    const tmpDir = path.resolve(path.join(os.tmpdir(), `rag-write-test-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "note.md");
    fs.writeFileSync(filePath, "# Hello", "utf-8");
    const connectorId = crypto.randomUUID();
    try {
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "filesystem",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ path: tmpDir }),
          status: "synced",
          lastSyncAt: Date.now(),
          createdAt: Date.now(),
        })
        .run();

      const readResult = await readConnectorItem(connectorId, filePath);
      expect(readResult).toHaveProperty("content", "# Hello");
      expect(readResult).toHaveProperty("mimeType", "text/markdown");

      const updateResult = await updateConnectorItem(connectorId, filePath, "# Updated");
      expect(updateResult).toEqual({ ok: true });
      const readAgain = await readConnectorItem(connectorId, filePath);
      expect(readAgain).toHaveProperty("content", "# Updated");
    } finally {
      await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });

  it("readConnectorItem returns error when item path is outside connector root", async () => {
    const tmpDir = path.resolve(path.join(os.tmpdir(), `rag-write-outside-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    const connectorId = crypto.randomUUID();
    try {
      await db
        .insert(ragConnectors)
        .values({
          id: connectorId,
          type: "filesystem",
          collectionId: crypto.randomUUID(),
          config: JSON.stringify({ path: tmpDir }),
          status: "synced",
          lastSyncAt: Date.now(),
          createdAt: Date.now(),
        })
        .run();
      const outsidePath = path.join(os.tmpdir(), "other", "file.txt");
      const result = await readConnectorItem(connectorId, outsidePath);
      expect(result).toEqual({ error: "Item path is outside connector root" });
    } finally {
      await db.delete(ragConnectors).where(eq(ragConnectors.id, connectorId)).run();
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });
});
