/**
 * E2E: Specialist models pipeline — training data, registration, trigger/status, and full flow.
 * (1) Training data + registration without trainer; (2) trigger_training + get_training_status;
 * (3) Full "obtain specialist model from agent" flow; (4) real short finetuning run when trainer is up.
 */
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { POST as feedbackPost } from "../../app/api/feedback/route";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

const LOCAL_TRAINER_URL = process.env.LOCAL_TRAINER_URL || "http://localhost:8765";
const TRAINER_POLL_INTERVAL_MS = 2000;
const TRAINER_POLL_TIMEOUT_MS = 60_000;

async function isTrainerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_TRAINER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe("e2e specialist-models-pipeline", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("specialist-models-pipeline");
    e2eLog.scenario(
      "specialist-models-pipeline",
      "Training data, register_trained_model, trigger/status, full flow"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("training data and registration without trainer: generate_training_data, register_trained_model, list_specialist_models, evaluate_model", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Specialist Pipeline Agent",
        description: "For specialist-models e2e",
        systemPrompt: "Reply with exactly: ok",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool("create_workflow", { name: "E2E Specialist WF" }, undefined);
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;
    const updateRes = await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [{ id: "n1", type: "agent", position: [0, 0], parameters: { agentId } }],
        edges: [],
      },
      undefined
    );
    expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));

    const execRes = await executeTool("execute_workflow", { workflowId }, undefined);
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    const runId = (execRes as { id?: string }).id;
    expect(typeof runId).toBe("string");
    e2eLog.runId(runId!);

    const postRes = await feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "agent",
          targetId: agentId,
          executionId: runId,
          input: "e2e",
          output: "ok",
          label: "good",
        }),
      })
    );
    expect(postRes.status).toBe(201);
    e2eLog.step("POST /api/feedback", {});

    const genRes = await executeTool(
      "generate_training_data",
      { strategy: "from_feedback", scopeType: "agent", scopeId: agentId },
      undefined
    );
    expect(genRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const datasetRef = (genRes as { datasetRef?: string }).datasetRef;
    expect(typeof datasetRef).toBe("string");
    if (!datasetRef) throw new Error("expected datasetRef");
    expect(fs.existsSync(datasetRef)).toBe(true);
    e2eLog.step("generate_training_data from_feedback", {
      datasetRef,
      count: (genRes as { count?: number }).count,
    });

    const jobRes = await executeTool(
      "create_improvement_job",
      { scopeType: "agent", scopeId: agentId, name: "E2E Specialist Job" },
      undefined
    );
    expect(jobRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const jobId = (jobRes as { id?: string }).id;
    expect(typeof jobId).toBe("string");
    e2eLog.step("create_improvement_job", { jobId });

    const regRes = await executeTool(
      "register_trained_model",
      { outputModelRef: "ollama:e2e-specialist", name: "E2E specialist model" },
      undefined
    );
    expect(regRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const llmConfigId = (regRes as { llmConfigId?: string }).llmConfigId;
    expect(typeof llmConfigId).toBe("string");
    expect(llmConfigId).toMatch(/^llm-trained-/);
    e2eLog.step("register_trained_model", { llmConfigId });

    const updateJobRes = await executeTool(
      "update_improvement_job",
      { id: jobId, currentModelRef: llmConfigId },
      undefined
    );
    expect(updateJobRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    e2eLog.step("update_improvement_job currentModelRef", {});

    const listRes = await executeTool("list_specialist_models", { agentId }, undefined);
    expect(listRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const jobs = (listRes as { jobs?: { jobId?: string; currentModelRef?: string }[] }).jobs;
    expect(Array.isArray(jobs)).toBe(true);
    const job = jobs!.find((j) => j.jobId === jobId);
    expect(job).toBeDefined();
    expect(job!.currentModelRef).toBe(llmConfigId);
    e2eLog.toolCall("list_specialist_models", JSON.stringify(listRes).slice(0, 150));

    const evalRes = await executeTool("evaluate_model", { jobId }, undefined);
    expect(evalRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect((evalRes as { evalId?: string }).evalId).toBeDefined();
    expect((evalRes as { metrics?: unknown }).metrics).toBeDefined();
    e2eLog.toolCall("evaluate_model", (evalRes as { evalId?: string }).evalId ?? "");
  }, 90_000);

  it("trigger_training and get_training_status return runId and status", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Trigger Status Agent",
        description: "For trigger/status e2e",
        systemPrompt: "ok",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    const jobRes = await executeTool(
      "create_improvement_job",
      { scopeType: "agent", scopeId: agentId },
      undefined
    );
    const jobId = (jobRes as { id?: string }).id;
    const genRes = await executeTool(
      "generate_training_data",
      { strategy: "from_feedback", scopeType: "agent", scopeId: agentId },
      undefined
    );
    const datasetRef = (genRes as { datasetRef?: string }).datasetRef;

    const triggerRes = await executeTool(
      "trigger_training",
      { jobId, datasetRef: datasetRef ?? "", backend: "local" },
      undefined
    );
    expect(triggerRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const runId = (triggerRes as { runId?: string }).runId;
    expect(typeof runId).toBe("string");
    e2eLog.step("trigger_training", { runId });

    const statusRes = await executeTool("get_training_status", { runId }, undefined);
    expect(statusRes).not.toEqual(expect.objectContaining({ error: "Run not found" }));
    expect((statusRes as { runId?: string }).runId).toBe(runId);
    expect(typeof (statusRes as { status?: string }).status).toBe("string");
    const status = (statusRes as { status?: string }).status;
    expect(["pending", "running", "completed", "failed"]).toContain(status);
    e2eLog.toolCall("get_training_status", status ?? "");
  }, 60_000);

  it("full flow: obtain specialist model from agent (create run, job, data, trigger, status, optionally register)", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Full Flow Agent",
        description: "Full specialist flow e2e",
        systemPrompt: "Reply with exactly: done",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");

    const wfRes = await executeTool("create_workflow", { name: "E2E Full Flow WF" }, undefined);
    const workflowId = (wfRes as { id?: string }).id;
    await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [{ id: "n1", type: "agent", position: [0, 0], parameters: { agentId } }],
        edges: [],
      },
      undefined
    );

    const execRes = await executeTool("execute_workflow", { workflowId }, undefined);
    const runId = (execRes as { id?: string }).id;
    expect(typeof runId).toBe("string");

    await feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "agent",
          targetId: agentId,
          executionId: runId,
          input: "e2e",
          output: "done",
          label: "good",
        }),
      })
    );

    const jobRes = await executeTool(
      "create_improvement_job",
      { scopeType: "agent", scopeId: agentId, name: "E2E Full Flow Job" },
      undefined
    );
    const jobId = (jobRes as { id?: string }).id;

    const genRes = await executeTool(
      "generate_training_data",
      { strategy: "from_feedback", scopeType: "agent", scopeId: agentId },
      undefined
    );
    const datasetRef = (genRes as { datasetRef?: string }).datasetRef;
    expect(typeof datasetRef).toBe("string");

    const triggerRes = await executeTool(
      "trigger_training",
      { jobId, datasetRef, backend: "local", experimentLabel: "e2e-full-flow" },
      undefined
    );
    expect(triggerRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const trainingRunId = (triggerRes as { runId?: string }).runId;
    expect(typeof trainingRunId).toBe("string");
    e2eLog.step("full flow trigger_training", { trainingRunId });

    const statusRes = await executeTool("get_training_status", { runId: trainingRunId }, undefined);
    expect(statusRes).not.toEqual(expect.objectContaining({ error: "Run not found" }));
    const status = (statusRes as { status?: string }).status;
    const outputModelRef = (statusRes as { outputModelRef?: string | null }).outputModelRef;

    if (status === "completed" && outputModelRef) {
      const regRes = await executeTool(
        "register_trained_model",
        { outputModelRef, jobId, name: "E2E full flow trained" },
        undefined
      );
      expect(regRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
      const llmConfigId = (regRes as { llmConfigId?: string }).llmConfigId;
      await executeTool(
        "update_improvement_job",
        { id: jobId, currentModelRef: llmConfigId },
        undefined
      );
      const listRes = await executeTool("list_specialist_models", { agentId }, undefined);
      const jobs = (listRes as { jobs?: { currentModelRef?: string }[] }).jobs;
      expect(jobs?.some((j) => j.currentModelRef === llmConfigId)).toBe(true);
      e2eLog.toolCall("full flow register + list", llmConfigId ?? "");
    } else {
      expect(["pending", "running", "completed", "failed"]).toContain(status);
      e2eLog.toolCall("full flow status (no trainer)", status ?? "");
    }
  }, 120_000);

  it("real short finetuning run: trigger → poll until completed → register → list", async () => {
    const trainerUp = await isTrainerReachable();
    if (!trainerUp) {
      e2eLog.toolCall(
        "real finetuning",
        `Trainer not reachable at ${LOCAL_TRAINER_URL} - skip. Run: node scripts/e2e-trainer/index.cjs`
      );
      return;
    }

    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Real Finetune Agent",
        description: "For real short finetuning e2e",
        systemPrompt: "Reply: ok",
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");

    const wfRes = await executeTool("create_workflow", { name: "E2E Real Finetune WF" }, undefined);
    const workflowId = (wfRes as { id?: string }).id;
    await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [{ id: "n1", type: "agent", position: [0, 0], parameters: { agentId } }],
        edges: [],
      },
      undefined
    );

    const execRes = await executeTool("execute_workflow", { workflowId }, undefined);
    const runId = (execRes as { id?: string }).id;
    expect(typeof runId).toBe("string");

    await feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "agent",
          targetId: agentId,
          executionId: runId,
          input: "e2e real finetune",
          output: "ok",
          label: "good",
        }),
      })
    );

    const genRes = await executeTool(
      "generate_training_data",
      { strategy: "from_feedback", scopeType: "agent", scopeId: agentId },
      undefined
    );
    const datasetRef = (genRes as { datasetRef?: string }).datasetRef;
    expect(typeof datasetRef).toBe("string");

    const jobRes = await executeTool(
      "create_improvement_job",
      { scopeType: "agent", scopeId: agentId, name: "E2E Real Finetune Job" },
      undefined
    );
    const jobId = (jobRes as { id?: string }).id;
    expect(typeof jobId).toBe("string");

    const triggerRes = await executeTool(
      "trigger_training",
      { jobId, datasetRef, backend: "local" },
      undefined
    );
    expect(triggerRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const trainingRunId = (triggerRes as { runId?: string }).runId;
    expect(typeof trainingRunId).toBe("string");
    e2eLog.step("real finetuning trigger_training", { trainingRunId });

    const deadline = Date.now() + TRAINER_POLL_TIMEOUT_MS;
    let statusRes: { status?: string; outputModelRef?: string | null };
    while (Date.now() < deadline) {
      statusRes = (await executeTool(
        "get_training_status",
        { runId: trainingRunId },
        undefined
      )) as {
        status?: string;
        outputModelRef?: string | null;
      };
      if (statusRes.status === "completed" || statusRes.status === "failed") break;
      await new Promise((r) => setTimeout(r, TRAINER_POLL_INTERVAL_MS));
    }

    expect(statusRes!.status).toBe("completed");
    expect(statusRes!.outputModelRef).toBeTruthy();
    const outputModelRef = statusRes!.outputModelRef!;
    e2eLog.step("get_training_status completed", { outputModelRef });

    const regRes = await executeTool(
      "register_trained_model",
      { outputModelRef, name: "E2E real finetuned" },
      undefined
    );
    expect(regRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const llmConfigId = (regRes as { llmConfigId?: string }).llmConfigId;
    expect(typeof llmConfigId).toBe("string");
    expect(llmConfigId).toMatch(/^llm-trained-/);

    await executeTool(
      "update_improvement_job",
      { id: jobId, currentModelRef: llmConfigId },
      undefined
    );

    const listRes = await executeTool("list_specialist_models", { agentId }, undefined);
    expect(listRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const jobs = (listRes as { jobs?: { jobId?: string; currentModelRef?: string }[] }).jobs;
    expect(jobs?.some((j) => j.jobId === jobId && j.currentModelRef === llmConfigId)).toBe(true);
    e2eLog.toolCall("real finetuning list_specialist_models", llmConfigId);
  }, 90_000);
});
