/**
 * SSE endpoint for decoupled chat: subscribe to events by turnId.
 * Client receives the same event types as the streaming POST (trace_step, plan, step_start, todo_done, done, error, content_delta).
 * When the first client subscribes, any pending job for this turnId is started in the background.
 */

import { subscribe, takePendingJob, finish } from "../../_lib/chat-event-channel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const turnId = searchParams.get("turnId")?.trim();
  if (!turnId) {
    return new Response(JSON.stringify({ error: "turnId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        try {
          const raw = JSON.stringify(data);
          controller.enqueue(encoder.encode(`data: ${raw}\n\n`));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/already closed|Invalid state/i.test(msg)) return;
          // Serialization or enqueue failed (e.g. circular ref in event); send minimal error so client stops loading
          try {
            const fallback =
              typeof data === "object" &&
              data !== null &&
              "type" in data &&
              (data as { type: string }).type === "done"
                ? {
                    type: "done" as const,
                    content: (data as { content?: string }).content ?? "",
                    messageId: (data as { messageId?: string }).messageId,
                    userMessageId: (data as { userMessageId?: string }).userMessageId,
                    conversationId: (data as { conversationId?: string }).conversationId,
                  }
                : { type: "error" as const, error: "Event delivery failed" };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(fallback)}\n\n`));
          } catch {
            // ignore
          }
        }
      };

      const unsub = subscribe(turnId, (event) => {
        send(event);
        if (event.type === "done" || event.type === "error") {
          finish(turnId);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });

      // Start pending job if any (run in background so we don't block the response).
      // If no job (e.g. another EventSource already took it, or React double-mount), stay subscribed
      // so we still receive events published by the connection that runs the job.
      const job = takePendingJob(turnId);
      if (job) {
        setImmediate(() => {
          job().catch((err: unknown) => {
            send({ type: "error", error: "Turn failed" });
            finish(turnId);
            try {
              controller.close();
            } catch {
              //
            }
          });
        });
      }
      // else: no job — another GET likely took it; we stay subscribed and receive the same events
      // Allow client to close the connection (request.signal) and unsubscribe
      request.signal?.addEventListener?.("abort", () => {
        unsub();
        try {
          controller.close();
        } catch {
          //
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
