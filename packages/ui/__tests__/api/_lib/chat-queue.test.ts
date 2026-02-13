import { describe, it, expect } from "vitest";
import { runSerializedByConversation } from "../../../app/api/_lib/chat-queue";

describe("chat-queue", () => {
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
});
