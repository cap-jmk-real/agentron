/**
 * list_connectors when DB has no connectors: returns [] so the assistant can direct the user
 * to add one (prompt block is tested in chat-route-post.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { executeTool } from "../../../app/api/chat/_lib/execute-tool";

vi.mock("../../../app/api/_lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../app/api/_lib/db")>();
  return {
    ...mod,
    db: {
      select: () => ({
        from: () => Promise.resolve([]),
      }),
    },
  };
});

describe("list_connectors when empty", () => {
  it("list_connectors returns empty array when no connectors in DB", async () => {
    const result = await executeTool("list_connectors", {}, undefined);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });
});
