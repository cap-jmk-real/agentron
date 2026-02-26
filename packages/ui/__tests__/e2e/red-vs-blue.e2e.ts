/**
 * E2E: Red vs Blue — workflow with Attacker (fetch + HTTP) and Defender (execute_code in target sandbox).
 * Target: in-repo image (agentron/red-vs-blue-target:latest). Build with:
 *   podman build -t agentron/red-vs-blue-target:latest packages/ui/__tests__/e2e/red-vs-blue-image
 * Image and container names are neutral so Defender cannot infer the vulnerability from std-list-sandboxes. Attacker must discover and try to exploit; Defender can read logs and harden.
 *
 * Run (repo root): npm run test:e2e-llm -- red-vs-blue
 * Log artifact (PowerShell): $env:E2E_SAVE_ARTIFACTS="1"; npm run test:e2e-llm -- red-vs-blue
 *
 * Containers: Created with the app's container engine (default Podman; or Docker if set in Settings).
 * The target sandbox is destroyed in afterAll so reruns do not fail.
 *
 * Progress: Set E2E_LOG_PROGRESS=1 or E2E_SAVE_ARTIFACTS=1 to log live workflow progress (trail, message) inferred from the DB while the run executes.
 *
 * Attacker uses std-fetch-url and std-http-request only (no web search). The agent does recon, then uses the CVE API (when openCveBaseUrl is in params) or knowledge to find and try relevant exploits — not limited to a single CVE.
 *
 * CVE lookup (required): The test expects the CVE database and API user to be set up before the test runs. From repo root run: npm run opencve-deploy (see scripts/README-OPENCVE.md). The deploy script starts OpenCVE, creates the API user, and prints the base URL and port. Then set OPENCVE_URL to that base URL (e.g. http://localhost:52054) and optionally OPENCVE_USER / OPENCVE_PASSWORD (default opencve / opencve). The test fails at start if OPENCVE_URL is not set.
 *
 * Context: noSharedOutput is true so agents do not see each other's output. Each agent knows its own context only: the engine injects that agent's previous turns into the prompt ("Recent turns:") before the LLM decides tools, so attacker sees only attacker turns and defender only defender turns.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { getExecutionLogForRun } from "../../app/api/_lib/execution-log";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog, startWorkflowProgressLogger } from "./e2e-logger";

const TARGET_IMAGE = "agentron/red-vs-blue-target:latest";
const TARGET_PORT = 80;
/** 5 rounds = 5 attacker + 5 defender = 10 total turns. */
const RED_VS_BLUE_MAX_ROUNDS = 5;

const DESIGN_TRACE_SYSTEM_PROMPT_MAX = 2000;

/** Truncate long string for artifact; return original if under limit. */
function truncateForArtifact(s: string | undefined, maxLen: number): string | undefined {
  if (s == null) return s;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n...[truncated]";
}

/** Build a copy of get_agent result safe for design_trace (truncate systemPrompt). */
function agentDesignForTrace(agent: Record<string, unknown>): Record<string, unknown> {
  const def = agent.definition as Record<string, unknown> | undefined;
  if (!def || typeof def !== "object") return agent;
  const systemPrompt = def.systemPrompt as string | undefined;
  const truncated = truncateForArtifact(systemPrompt, DESIGN_TRACE_SYSTEM_PROMPT_MAX);
  const defCopy = { ...def };
  if (truncated !== undefined) defCopy.systemPrompt = truncated;
  return { ...agent, definition: defCopy };
}

async function tearDownSandbox(sandboxId: string): Promise<void> {
  try {
    const { DELETE: deleteSandbox } = await import("../../app/api/sandbox/[id]/route");
    const res = await deleteSandbox(new Request("http://localhost"), {
      params: Promise.resolve({ id: sandboxId }),
    });
    if (res.ok) e2eLog.step("red-vs-blue sandbox torn down", { sandboxId });
  } catch (e) {
    e2eLog.toolCall("red-vs-blue teardown", String(e));
  }
}

describe("e2e red-vs-blue", () => {
  const start = Date.now();
  let targetSandboxId: string;
  let targetUrl: string;
  let attackerAgentId: string;
  let defenderAgentId: string;
  let workflowId: string;
  let runId: string;

  beforeAll(() => {
    e2eLog.startTest("red-vs-blue");
    e2eLog.scenario(
      "red-vs-blue",
      "Attacker (fetch + HTTP; CVE via std-http-request when openCveBaseUrl in params) vs Defender (execute_code in target); target container"
    );
  });

  afterAll(async () => {
    if (typeof targetSandboxId !== "undefined") {
      await tearDownSandbox(targetSandboxId);
    }
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("creates target sandbox, attacker and defender agents, workflow; runs with runInputs and asserts trail", async () => {
    // OpenCVE must be set up before the test (npm run opencve-deploy, then set OPENCVE_URL and optionally OPENCVE_USER/OPENCVE_PASSWORD)
    const openCveUrl = process.env.OPENCVE_URL?.trim();
    if (!openCveUrl) {
      throw new Error(
        "Red-vs-blue e2e requires OpenCVE. Set up the CVE database and API user first: run 'npm run opencve-deploy' from repo root (see scripts/README-OPENCVE.md). Then set OPENCVE_URL to the OpenCVE base URL (e.g. http://localhost:52054 — the deploy script prints the port) and optionally OPENCVE_USER and OPENCVE_PASSWORD (default opencve/opencve)."
      );
    }

    // Tear down any existing red-blue-target sandbox so port is free (e.g. from a previous failed run)
    const listRes = await executeTool("list_sandboxes", {}, undefined);
    const list = Array.isArray(listRes) ? listRes : [];
    const existing = list.filter(
      (s: { name?: string }) => typeof s.name === "string" && s.name === "red-blue-target"
    );
    for (const s of existing) {
      const id = (s as { id?: string }).id;
      if (typeof id === "string") await tearDownSandbox(id);
    }

    e2eLog.step("create_sandbox", { image: TARGET_IMAGE, containerPort: TARGET_PORT });
    const createSb = await executeTool(
      "create_sandbox",
      {
        image: TARGET_IMAGE,
        name: "red-blue-target",
        useImageCmd: true,
        containerPort: TARGET_PORT,
      },
      undefined
    );
    expect(createSb).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect((createSb as { status?: string }).status).toBe("running");
    targetSandboxId = (createSb as { id?: string }).id as string;
    expect(typeof targetSandboxId).toBe("string");
    const hostPort = (createSb as { hostPort?: number }).hostPort;
    expect(typeof hostPort).toBe("number");
    targetUrl = `http://127.0.0.1:${hostPort}`;
    e2eLog.step("create_sandbox done", { targetSandboxId, hostPort, targetUrl });

    e2eLog.step("create_agent Attacker");
    const attackerRes = await executeTool(
      "create_agent",
      {
        name: "E2E Red Team Attacker",
        description:
          "Probes target URL, uses recon and CVE API to discover and research vulnerabilities, attempts to exploit",
        systemPrompt: `You are a red-team agent. Your target is at the URL provided in the workflow parameters (targetUrl). Use that value literally in every std-fetch-url and std-http-request call. Do not use "http://target" — use the exact targetUrl string from the parameters. You do not see the other side's output; use your tools to observe state.

(1) Recon: probe the target — fetch root and common paths, inspect responses and headers to infer what is running (server, versions, tech, endpoints). (2) Research: when workflow parameters include openCveBaseUrl (and openCveUser, openCvePassword), use std-http-request to query the CVE API — search by keywords that match what you found in recon (e.g. server name, component, or CVE id if you suspect one); GET {openCveBaseUrl}/api/cve?search=<keyword> or GET {openCveBaseUrl}/api/cve/<CVE-ID>. Use Basic Auth with openCveUser and openCvePassword in the Authorization header. Use the CVE database and your knowledge to identify relevant vulnerabilities. (3) Exploit: try exploits that match your recon and research; if a prior attempt failed, try other paths or CVEs. Your own previous turns appear above (Recent turns). Report briefly what you did and whether you got code execution or an interesting response. Tools: std-fetch-url, std-http-request.`,
        toolIds: ["std-fetch-url", "std-http-request"],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(attackerRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    attackerAgentId = (attackerRes as { id?: string }).id as string;
    expect(typeof attackerAgentId).toBe("string");
    e2eLog.step("create_agent Attacker done", { attackerAgentId });

    e2eLog.step("create_agent Defender");
    const defenderRes = await executeTool(
      "create_agent",
      {
        name: "E2E Blue Team Defender",
        description: "Defends the target sandbox; observes and hardens via execute_code",
        systemPrompt: `You defend the target server. You have execute_code in the target sandbox. You do not see the other side's output; use your tools to observe state. Always use the exact targetSandboxId from the workflow parameters for std-execute-code; do not substitute a different sandbox ID from std-list-sandboxes. Inside the sandbox, the web server is at 127.0.0.1 (use 127.0.0.1 in curl/wget, not the hostname "target"). Observe the system with commands (e.g. list or read files, check processes, inspect logs); harden or remediate based on what you find; when you make changes, verify they worked. Example of running a command: std-execute-code with sandboxId from parameters and command (e.g. "ls -la /var/log" or "cat /etc/os-release"). Your own previous turns appear above (Recent turns). Reply briefly with what you did and whether verification succeeded.`,
        toolIds: ["std-execute-code", "std-list-sandboxes"],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(defenderRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    defenderAgentId = (defenderRes as { id?: string }).id as string;
    expect(typeof defenderAgentId).toBe("string");
    e2eLog.step("create_agent Defender done", { defenderAgentId });

    e2eLog.step("create_workflow");
    const wfRes = await executeTool("create_workflow", { name: "E2E Red vs Blue WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    workflowId = (wfRes as { id?: string }).id as string;
    expect(typeof workflowId).toBe("string");
    e2eLog.step("create_workflow done", { workflowId });

    e2eLog.step("update_workflow", {
      nodes: "attacker, defender",
      maxRounds: RED_VS_BLUE_MAX_ROUNDS,
    });
    const updateRes = await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [
          {
            id: "attacker",
            type: "agent",
            position: [0, 0],
            parameters: { agentId: attackerAgentId },
          },
          {
            id: "defender",
            type: "agent",
            position: [200, 0],
            parameters: { agentId: defenderAgentId },
          },
        ],
        edges: [
          { id: "e1", source: "attacker", target: "defender" },
          { id: "e2", source: "defender", target: "attacker" },
        ],
        maxRounds: RED_VS_BLUE_MAX_ROUNDS,
      },
      undefined
    );
    expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    e2eLog.step("update_workflow done");

    const runInputs: Record<string, string> = { targetUrl, targetSandboxId };
    runInputs.openCveBaseUrl = openCveUrl.replace(/\/$/, "");
    runInputs.openCveUser = process.env.OPENCVE_USER ?? "opencve";
    runInputs.openCvePassword = process.env.OPENCVE_PASSWORD ?? "opencve";
    e2eLog.step("runInputs include OpenCVE for red agent", {
      openCveBaseUrl: runInputs.openCveBaseUrl,
    });

    const getWfRes = await executeTool("get_workflow", { id: workflowId }, undefined);
    if (
      getWfRes &&
      typeof getWfRes === "object" &&
      "error" in getWfRes &&
      typeof (getWfRes as { error: string }).error === "string"
    ) {
      e2eLog.step("workflow_topo", { error: (getWfRes as { error: string }).error });
    } else {
      const w = getWfRes as {
        id?: string;
        name?: string;
        nodes?: unknown[];
        edges?: unknown[];
        maxRounds?: number;
        executionMode?: string;
        turnInstruction?: string | null;
        branches?: unknown;
      };
      e2eLog.step("workflow_topo", {
        workflowId: w.id ?? workflowId,
        name: w.name,
        nodes: w.nodes ?? [],
        edges: w.edges ?? [],
        maxRounds: w.maxRounds,
        executionMode: w.executionMode,
        turnInstruction: w.turnInstruction,
        branches: w.branches,
      });
    }

    const attackerAgentRes = await executeTool("get_agent", { id: attackerAgentId }, undefined);
    const defenderAgentRes = await executeTool("get_agent", { id: defenderAgentId }, undefined);
    type AgentRow = {
      id?: string;
      name?: string;
      error?: string;
      definition?: { toolIds?: string[] };
    };
    const a1 = attackerAgentRes as AgentRow;
    const a2 = defenderAgentRes as AgentRow;
    const toolIds1 = a1.definition?.toolIds ?? [];
    const toolIds2 = a2.definition?.toolIds ?? [];
    if (a1.error || a2.error) {
      e2eLog.step("agent_topo", { error: a1.error ?? a2.error });
    } else {
      e2eLog.step("agent_topo", {
        agents: [
          { id: attackerAgentId, name: a1.name, toolIds: toolIds1 },
          { id: defenderAgentId, name: a2.name, toolIds: toolIds2 },
        ],
      });
    }

    // Tool definitions used by this run (id, name, protocol, config, inputSchema) for full picture
    const allToolIds = [...new Set([...toolIds1, ...toolIds2])];
    const toolDefs: Array<Record<string, unknown>> = [];
    for (const id of allToolIds) {
      const res = await executeTool("get_tool", { id }, undefined);
      if (res && typeof res === "object" && "error" in res) {
        toolDefs.push({ id, error: (res as { error: string }).error });
      } else {
        const t = res as {
          id?: string;
          name?: string;
          protocol?: string;
          config?: unknown;
          inputSchema?: unknown;
        };
        toolDefs.push({
          id: t.id ?? id,
          name: t.name,
          protocol: t.protocol,
          config: t.config,
          inputSchema: t.inputSchema,
        });
      }
    }
    e2eLog.step("tool_definitions", { tools: toolDefs });

    // Full Agentron design trace: workflow + agents as stored (how everything was designed)
    if (
      getWfRes &&
      typeof getWfRes === "object" &&
      !("error" in getWfRes) &&
      !a1.error &&
      !a2.error
    ) {
      e2eLog.step("design_trace", {
        workflow: getWfRes as Record<string, unknown>,
        agents: [
          agentDesignForTrace(a1 as Record<string, unknown>),
          agentDesignForTrace(a2 as Record<string, unknown>),
        ],
      });
    }

    // Design phase: this e2e uses test script (executeTool), not chat — no assistant LLM outputs
    e2eLog.step("design_phase_llm", {
      note: "Design by test script; no chat. For chat-driven design, assistant content and llmTrace would be logged here.",
    });

    e2eLog.step("run_inputs", runInputs);
    e2eLog.step("execute_workflow", { targetUrl, targetSandboxId });
    const stopProgress = startWorkflowProgressLogger(workflowId);
    let execRes: unknown;
    try {
      execRes = await executeTool(
        "execute_workflow",
        {
          workflowId,
          inputs: { ...runInputs, noSharedOutput: true },
        },
        undefined
      );
    } finally {
      stopProgress();
    }
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    runId = (execRes as { id?: string }).id as string;
    expect(typeof runId).toBe("string");
    e2eLog.runId(runId);
    e2eLog.toolCall("execute_workflow", `status: ${(execRes as { status?: string }).status}`);

    const status = (execRes as { status?: string }).status;
    expect(["completed", "failed"]).toContain(status);

    let output = (execRes as { output?: unknown }).output;
    if (typeof output === "string") {
      try {
        output = JSON.parse(output) as { trail?: unknown[] };
      } catch {
        output = {};
      }
    }
    const trail = Array.isArray(
      output && typeof output === "object" && (output as { trail?: unknown[] }).trail
    )
      ? (output as { trail: unknown[] }).trail
      : [];
    e2eLog.step("trail summary", { stepCount: trail.length, status });

    trail.forEach((step, i) => {
      const s = step as { nodeId?: string; agentName?: string; output?: string };
      e2eLog.step(`trail[${i}]`, {
        nodeId: s.nodeId,
        agentName: s.agentName,
        outputPreview:
          typeof s.output === "string" ? s.output.slice(0, 150) : String(s.output).slice(0, 150),
      });
    });

    if (process.env.E2E_SAVE_ARTIFACTS === "1") {
      const executionLogEntries = await getExecutionLogForRun(runId);
      const executionLog = executionLogEntries.map((e) => ({
        phase: e.phase,
        label: e.label,
        payload: e.payload,
      }));
      e2eLog.writeRunArtifact(runId, output, trail, executionLog);
    }

    expect(trail.length).toBeGreaterThanOrEqual(2);
    const hasAttacker = trail.some((s) => (s as { nodeId?: string }).nodeId === "attacker");
    const hasDefender = trail.some((s) => (s as { nodeId?: string }).nodeId === "defender");
    expect(hasAttacker).toBe(true);
    expect(hasDefender).toBe(true);
  }, 600_000);
});
