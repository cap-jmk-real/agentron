/**
 * E2E: RAG embedding providers CRUD via API. Does not require Ollama.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as provPost } from "../../app/api/rag/embedding-providers/route";
import { GET as provListGet } from "../../app/api/rag/embedding-providers/route";
import {
  GET as provGet,
  PUT as provPut,
  DELETE as provDelete,
} from "../../app/api/rag/embedding-providers/[id]/route";
import { e2eLog } from "./e2e-logger";

describe("e2e rag-embedding-providers", () => {
  const start = Date.now();
  let createdId: string;

  beforeAll(() => {
    e2eLog.startTest("rag-embedding-providers");
    e2eLog.scenario(
      "rag-embedding-providers",
      "POST embedding provider (local) → GET list → GET by id → PUT → DELETE"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("CRUD embedding provider via API", async () => {
    const createRes = await provPost(
      new Request("http://localhost/api/rag/embedding-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E2E Ollama",
          type: "local",
          endpoint: "http://localhost:11434",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeDefined();
    expect(created.name).toBe("E2E Ollama");
    expect(created.type).toBe("local");
    createdId = created.id;
    e2eLog.step("POST embedding provider", { id: createdId });

    const listRes = await provListGet();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((p: { id: string }) => p.id === createdId);
    expect(found).toBeDefined();
    expect(found.name).toBe("E2E Ollama");
    e2eLog.step("GET list", { count: list.length });

    const getRes = await provGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(200);
    const one = await getRes.json();
    expect(one.id).toBe(createdId);
    expect(one.endpoint).toBe("http://localhost:11434");
    e2eLog.step("GET by id", {});

    const putRes = await provPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "E2E Ollama (renamed)" }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.name).toBe("E2E Ollama (renamed)");
    e2eLog.step("PUT update name", {});

    const deleteRes = await provDelete(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(deleteRes.status).toBe(200);
    const getAfterRes = await provGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getAfterRes.status).toBe(404);
    e2eLog.step("DELETE", {});
  });
});
