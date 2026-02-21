/**
 * E2E: Reminders round-trip — create_reminder, list_reminders, cancel_reminder via executeTool (no LLM).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { e2eLog } from "./e2e-logger";

describe("e2e reminders-roundtrip", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("reminders-roundtrip");
    e2eLog.scenario("reminders-roundtrip", "create_reminder → list_reminders → cancel_reminder");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("create_reminder then list_reminders returns the reminder; cancel_reminder removes it", async () => {
    const createRes = await executeTool(
      "create_reminder",
      { message: "E2E reminder round-trip", inMinutes: 60 },
      undefined
    );
    expect(createRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const created = createRes as { id?: string; runAt?: number; status?: string };
    expect(created.id).toBeDefined();
    expect(created.status).toBe("pending");
    e2eLog.step("create_reminder", { id: created.id });

    const listRes = await executeTool("list_reminders", { status: "pending" }, undefined);
    expect(listRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const list = listRes as { reminders?: { id: string; message: string }[] };
    expect(Array.isArray(list.reminders)).toBe(true);
    const found = list.reminders!.find((r) => r.id === created.id);
    expect(found).toBeDefined();
    expect(found!.message).toBe("E2E reminder round-trip");
    e2eLog.toolCall("list_reminders", `${list.reminders!.length} reminder(s)`);

    const cancelRes = await executeTool("cancel_reminder", { id: created.id }, undefined);
    expect(cancelRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    e2eLog.toolCall("cancel_reminder", "ok");

    const listAfter = await executeTool("list_reminders", { status: "pending" }, undefined);
    const listAfterData = listAfter as { reminders?: { id: string }[] };
    const stillPending = listAfterData.reminders?.find((r) => r.id === created.id);
    expect(stillPending).toBeUndefined();
  });
});
