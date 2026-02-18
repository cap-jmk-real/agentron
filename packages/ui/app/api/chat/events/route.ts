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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/already closed|Invalid state/i.test(msg)) throw e;
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

      // Start pending job if any (run in background so we don't block the response)
      const job = takePendingJob(turnId);
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"chat/events/route.ts:job_taken",message:"events: job taken?",data:{turnId,jobTaken:!!job},hypothesisId:"H4",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (job) {
        setImmediate(() => {
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"chat/events/route.ts:job_executing",message:"events: executing job",data:{turnId},hypothesisId:"H4",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          job().catch((err: unknown) => {
            // #region agent log
            const errMsg = err instanceof Error ? err.message : String(err);
            const errName = err instanceof Error ? err.name : "";
            if (typeof fetch !== "undefined") fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e0760a'},body:JSON.stringify({sessionId:'e0760a',location:'chat/events/route.ts:job_catch',message:'job rejected',data:{error:errMsg,name:errName,turnId},hypothesisId:'H4',timestamp:Date.now()})}).catch(()=>{});
            // #endregion
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

      // If no job, client may have connected late; they'll just wait for events or timeout.
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
