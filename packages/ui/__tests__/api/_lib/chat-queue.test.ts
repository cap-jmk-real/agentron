import { describe, it, expect, vi } from "vitest";
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

  it("releaseLock catch does not throw when db.delete fails", async () => {
    const convId = "conv-release-catch-" + Date.now();
    const deleteSpy = vi.spyOn(db, "delete").mockReturnValueOnce({
      where: () => ({ run: () => Promise.reject(new Error("delete failed")) }),
    } as unknown as ReturnType<typeof db.delete>);
    try {
      const result = await runSerializedByConversation(convId, async () => "ok");
      expect(result).toBe("ok");
    } finally {
      deleteSpy.mockRestore();
    }
  });

  it("releaseLock catch when db.delete fails with alreadyLocked (only delete is in release)", async () => {
    const convId = "conv-release-already-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    const deleteSpy = vi.spyOn(db, "delete").mockReturnValueOnce({
      where: () => ({ run: () => Promise.reject(new Error("delete failed")) }),
    } as unknown as ReturnType<typeof db.delete>);
    try {
      const result = await runSerializedByConversation(convId, async () => "ok", {
        alreadyLocked: true,
      });
      expect(result).toBe("ok");
    } finally {
      deleteSpy.mockRestore();
      await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, convId)).run();
    }
  });

  it("rethrows when acquireLock insert fails with non-UNIQUE error", async () => {
    const convId = "conv-insert-other-" + Date.now();
    const insertSpy = vi.spyOn(db, "insert").mockReturnValueOnce({
      values: () => ({
        run: () => Promise.reject(new Error("some other db error")),
      }),
    } as unknown as ReturnType<typeof db.insert>);
    try {
      await expect(runSerializedByConversation(convId, async () => "ok")).rejects.toThrow(
        "some other db error"
      );
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("throws Timeout waiting for conversation lock when lock is held until deadline", async () => {
    const convId = "conv-timeout-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    const lockWaitMs = 60_000;
    await vi.useFakeTimers();
    let caught: Error | undefined;
    try {
      const promise = runSerializedByConversation(convId, async () => "never");
      const advance = vi.advanceTimersByTimeAsync(lockWaitMs + 100);
      await Promise.all([
        promise.catch((e: Error) => {
          caught = e;
        }),
        advance,
      ]);
      expect(caught).toBeDefined();
      expect(caught!.message).toBe("Timeout waiting for conversation lock");
    } finally {
      vi.useRealTimers();
      await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, convId)).run();
    }
  });
});
