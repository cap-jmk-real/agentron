/**
 * E2E: Chat-driven design — one chat turn that should result in create_workflow, create_agent, execute_workflow.
 * Validates that created agents have a proper graph and workflows have agent nodes wired (so we don't regress on input shape).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { GET as getAgent } from "../../app/api/agents/[id]/route";
import { GET as getWorkflow } from "../../app/api/workflows/[id]/route";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

type ToolResult = {
  name: string;
  result?: { id?: string; error?: string; errorCode?: string };
  specialistId?: string;
};

type PlanSummary = { refinedTask?: string; route?: (string | { parallel: string[] })[] };
type StreamEvent = {
  type?: string;
  toolResults?: ToolResult[];
  content?: string;
  error?: string;
  planSummary?: PlanSummary;
};

/** Build a short diagnostic for create_agent/create_workflow results to log (no huge payloads). */
function toolResultsDiagnostic(toolResults: ToolResult[]): {
  createAgentCount: number;
  withAgentId: number;
  createWorkflowCount: number;
  withWorkflowId: number;
  agentShapes: { hasResult: boolean; hasId: boolean; specialistId?: string; error?: string }[];
  workflowShapes: { hasResult: boolean; hasId: boolean; specialistId?: string; error?: string }[];
} {
  const createAgent = toolResults.filter((r) => r.name === "create_agent");
  const createWorkflow = toolResults.filter((r) => r.name === "create_workflow");
  return {
    createAgentCount: createAgent.length,
    withAgentId: createAgent.filter((r) => r.result?.id).length,
    createWorkflowCount: createWorkflow.length,
    withWorkflowId: createWorkflow.filter((r) => r.result?.id).length,
    agentShapes: createAgent.slice(0, 5).map((r) => ({
      hasResult: !!r.result,
      hasId: !!(r.result as { id?: string })?.id,
      specialistId: r.specialistId,
      error: (r.result as { error?: string })?.error?.slice(0, 120),
    })),
    workflowShapes: createWorkflow.slice(0, 5).map((r) => ({
      hasResult: !!r.result,
      hasId: !!(r.result as { id?: string })?.id,
      specialistId: r.specialistId,
      error: (r.result as { error?: string })?.error?.slice(0, 120),
    })),
  };
}

async function readEventStream(turnId: string): Promise<StreamEvent[]> {
  const res = await getChatEvents(
    new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
  );
  if (!res.ok || !res.body) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value);
    if (done) break;
  }
  reader.releaseLock();
  const events: StreamEvent[] = [];
  for (const chunk of buffer.split("\n\n").filter((s) => s.trim())) {
    const m = chunk.match(/^data:\s*(.+)$/m);
    if (m) {
      try {
        events.push(JSON.parse(m[1].trim()));
      } catch {
        // skip
      }
    }
  }
  return events;
}

/** Stream must end with a terminal event (done or error) so clients know whether the turn completed. */
function getTerminalEvent(events: StreamEvent[]): StreamEvent | undefined {
  return events.find((e) => e?.type === "done" || e?.type === "error");
}

/** Derived route from planner (priorityOrder). Present on done.planSummary or on trace_step with phase "heap_route". */
function getDerivedRoute(events: StreamEvent[]): PlanSummary | undefined {
  const done = events.find((e) => e?.type === "done") as { planSummary?: PlanSummary } | undefined;
  if (done?.planSummary) return done.planSummary;
  const heapRoute = events.find(
    (e) =>
      (e as { type?: string; phase?: string }).type === "trace_step" &&
      (e as { phase?: string }).phase === "heap_route"
  ) as { priorityOrder?: PlanSummary["route"]; refinedTask?: string } | undefined;
  if (heapRoute?.priorityOrder)
    return { route: heapRoute.priorityOrder, refinedTask: heapRoute.refinedTask };
  return undefined;
}

const MAX_TURN_ATTEMPTS = 5;

describe("e2e chat-driven-design", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("chat-driven-design");
    e2eLog.scenario(
      "chat-driven-design",
      "Create workflow with one agent that fetches example.com, then run it"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("one chat turn produces create_agent and create_workflow when prompted for both", async () => {
    let doneEvent: StreamEvent | undefined;
    let toolResults: ToolResult[] = [];

    for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt++) {
      const createRes = await convPost(
        new Request("http://localhost/api/chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "E2E chat-driven" }),
        })
      );
      const conv = await createRes.json();
      const conversationId = conv.id as string;
      expect(typeof conversationId).toBe("string");
      e2eLog.step("create_conversation", { conversationId });

      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message:
              "Create a workflow with one agent that fetches https://example.com and replies with the page title. Then run it.",
            conversationId,
            providerId: E2E_LLM_CONFIG_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res).toBeDefined();
      expect(res!.status).toBe(202);
      const data = await res!.json();
      const turnId = data.turnId;
      expect(typeof turnId).toBe("string");

      const events = await readEventStream(turnId);
      const terminal = getTerminalEvent(events);
      if (!terminal) {
        const derived = getDerivedRoute(events);
        const eventTypes = events.map((e) => e?.type ?? "unknown");
        e2eLog.step("stream_no_terminal", {
          attempt,
          eventCount: events.length,
          eventTypes: eventTypes.slice(-15),
          ...(derived && {
            derivedRoute: derived.route,
            refinedTask: derived.refinedTask?.slice(0, 200),
          }),
        });
      }
      expect(
        terminal,
        "Stream must end with a terminal event (done or error); stream may have closed before turn completed."
      ).toBeDefined();
      if (terminal!.type === "error") {
        const derived = getDerivedRoute(events);
        e2eLog.step("retry_turn", {
          attempt,
          maxAttempts: MAX_TURN_ATTEMPTS,
          reason: "error_event",
          error: (terminal as { error?: string }).error,
          ...(derived && {
            derivedRoute: derived.route,
            refinedTask: derived.refinedTask?.slice(0, 200),
          }),
        });
        continue;
      }
      doneEvent = terminal;
      toolResults = (doneEvent as { toolResults?: ToolResult[] })?.toolResults ?? [];
      const names = toolResults.map((r) => r.name);
      e2eLog.toolCall("chat_turn", names.join(","));

      const planSummary = (doneEvent as { planSummary?: PlanSummary }).planSummary;
      if (planSummary) {
        e2eLog.step("derived_route", {
          attempt,
          refinedTask: planSummary.refinedTask?.slice(0, 200),
          route: planSummary.route,
        });
      }

      const diagnostic = toolResultsDiagnostic(toolResults);
      e2eLog.step("tool_results_diagnostic", {
        attempt,
        ...diagnostic,
      });

      const hasCreateAgent = names.includes("create_agent");
      const hasCreateWorkflow = names.includes("create_workflow");
      if (hasCreateAgent && hasCreateWorkflow) {
        e2eLog.step("turn_success_both_tools", {
          attempt,
          maxAttempts: MAX_TURN_ATTEMPTS,
          ...diagnostic,
        });
        break;
      }
      e2eLog.step("retry_turn", { attempt, maxAttempts: MAX_TURN_ATTEMPTS });
    }

    const names = toolResults.map((r) => r.name);
    const hasCreateAgent = names.includes("create_agent");
    const hasCreateWorkflow = names.includes("create_workflow");
    const hasExecuteWorkflow = names.includes("execute_workflow");
    expect(
      hasCreateAgent && hasCreateWorkflow,
      "Prompt asks for workflow with one agent; both create_agent and create_workflow must appear in toolResults."
    ).toBe(true);
    if (hasExecuteWorkflow) {
      const execResult = toolResults.find((r) => r.name === "execute_workflow") as {
        result?: { status?: string };
      };
      expect(["completed", "failed", "waiting_for_user", "running"]).toContain(
        execResult?.result?.status ?? "unknown"
      );
    }
    expect(typeof (doneEvent as { content?: string }).content).toBe("string");

    const createdAgentIds = toolResults
      .filter((r) => r.name === "create_agent" && r.result?.id)
      .map((r) => (r.result as { id: string }).id);
    const createdWorkflowIds = toolResults
      .filter((r) => r.name === "create_workflow" && r.result?.id)
      .map((r) => (r.result as { id: string }).id);

    const planSummary = (doneEvent as { planSummary?: PlanSummary }).planSummary;
    if (planSummary) {
      e2eLog.step("assertion_derived_route", {
        refinedTask: planSummary.refinedTask?.slice(0, 200),
        route: planSummary.route,
      });
    }
    const preAssertDiagnostic = toolResultsDiagnostic(toolResults);
    e2eLog.step("assertion_pre_ids", {
      createdAgentIdsLength: createdAgentIds.length,
      createdWorkflowIdsLength: createdWorkflowIds.length,
      ...preAssertDiagnostic,
    });

    expect(
      createdAgentIds.length,
      "create_agent must return an id when both agent and workflow are required"
    ).toBeGreaterThan(0);
    expect(
      createdWorkflowIds.length,
      "create_workflow must return an id when both agent and workflow are required"
    ).toBeGreaterThan(0);

    if (createdAgentIds.length > 0) {
      const lastAgentId = createdAgentIds[createdAgentIds.length - 1];
      const agentRes = await getAgent(new Request("http://localhost/"), {
        params: Promise.resolve({ id: lastAgentId }),
      });
      expect(agentRes.status).toBe(200);
      const agent = await agentRes.json();
      expect((agent as { error?: string }).error).toBeUndefined();
      const definition = (
        agent as { definition?: { graph?: { nodes?: unknown[] }; toolIds?: string[] } }
      ).definition;
      expect(definition).toBeDefined();
      expect(
        (definition?.graph?.nodes?.length ?? 0) >= 1,
        "created agent must have at least one node in definition.graph"
      ).toBe(true);
      if (definition?.toolIds?.length) {
        expect(definition.toolIds.length).toBeGreaterThan(0);
      }
    }

    if (createdWorkflowIds.length > 0) {
      const lastWorkflowId = createdWorkflowIds[createdWorkflowIds.length - 1];
      const wfRes = await getWorkflow(new Request("http://localhost/"), {
        params: Promise.resolve({ id: lastWorkflowId }),
      });
      expect(wfRes.status).toBe(200);
      const workflow = await wfRes.json();
      expect((workflow as { error?: string }).error).toBeUndefined();
      const nodes = (workflow as { nodes?: { parameters?: { agentId?: string } }[] }).nodes ?? [];
      expect(
        nodes.length >= 1,
        "created workflow must have at least one node (agent wired via update_workflow)"
      ).toBe(true);
      const hasAgentNode = nodes.some(
        (n) => n.parameters?.agentId && typeof n.parameters.agentId === "string"
      );
      expect(hasAgentNode, "workflow must have at least one node with parameters.agentId").toBe(
        true
      );
    }
  }, 600_000);
});
