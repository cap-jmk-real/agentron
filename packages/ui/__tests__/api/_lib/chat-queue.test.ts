import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { runSerializedByConversation } from "../../../app/api/_lib/chat-queue";
import { db, conversationLocks } from "../../../app/api/_lib/db";

describe("chat-queue", () => {
  it("alreadyLocked: true runs handler and releases lock", async () => {
    const convId = "conv-already-locked-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    const result = await runSerializedByConversation(convId, async () => "result", {
      alreadyLocked: true,
    });
    expect(result).toBe("result");
    const rows = await db
      .select()
      .from(conversationLocks)
      .where(eq(conversationLocks.conversationId, convId));
    expect(rows.length).toBe(0);
  });

  it("alreadyLocked: true still releases lock on handler throw", async () => {
    const convId = "conv-already-locked-throw-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    await expect(
      runSerializedByConversation(
        convId,
        async () => {
          throw new Error("oops");
        },
        { alreadyLocked: true }
      )
    ).rejects.toThrow("oops");
    const rows = await db
      .select()
      .from(conversationLocks)
      .where(eq(conversationLocks.conversationId, convId));
    expect(rows.length).toBe(0);
    const second = await runSerializedByConversation(convId, async () => "second");
    expect(second).toBe("second");
  });

  it("returns handler result", async () => {
    const result = await runSerializedByConversation("conv-1", async () => "ok");
    expect(result).toBe("ok");
  });

  it("runs same-conversation handlers serially", async () => {
    const order: number[] = [];
    const run = (id: number) =>
      runSerializedByConversation("conv-serial", async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, 10));
        order.push(-id);
      });

    await Promise.all([run(1), run(2), run(3)]);
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it("different conversations can run in parallel", async () => {
    const order: number[] = [];
    const run = (convId: string, id: number) =>
      runSerializedByConversation(convId, async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, 20));
        order.push(-id);
      });

    await Promise.all([run("c-a", 1), run("c-b", 2)]);
    expect(order).toHaveLength(4);
    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order).toContain(-1);
    expect(order).toContain(-2);
    expect(order[0]).not.toBe(order[1]);
  });

  it("propagates handler rejection", async () => {
    await expect(
      runSerializedByConversation("conv-err", async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");
  });

  it("when first handler rejects, second handler still runs", async () => {
    const firstPromise = runSerializedByConversation("conv-reject", async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("Stopped by user");
    });
    const secondPromise = runSerializedByConversation("conv-reject", async () => "second");
    await expect(firstPromise).rejects.toThrow("Stopped by user");
    const result = await secondPromise;
    expect(result).toBe("second");
  });

  it("removes stale lock and acquires when previous lock is older than 5 min", async () => {
    const convId = "conv-stale-" + Date.now();
    const staleAt = Date.now() - 6 * 60 * 1000;
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: staleAt, createdAt: staleAt })
      .run();
    const result = await runSerializedByConversation(convId, async () => "after-stale");
    expect(result).toBe("after-stale");
    const rows = await db
      .select()
      .from(conversationLocks)
      .where(eq(conversationLocks.conversationId, convId));
    expect(rows.length).toBe(0);
  });
});
