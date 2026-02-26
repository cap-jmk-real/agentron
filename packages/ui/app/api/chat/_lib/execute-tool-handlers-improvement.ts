/**
 * Tool handlers for improvement jobs and training: create_improvement_job through list_specialist_models.
 */
import type { ExecuteToolContext, ExecuteToolFn } from "./execute-tool-shared";
import path from "node:path";
import fs from "node:fs";
import {
  db,
  getDataDir,
  improvementJobs,
  techniqueInsights,
  techniquePlaybook,
  trainingRuns,
  evalResults,
  feedback,
  executions,
  llmConfigs,
  toLlmConfigRow,
} from "../../_lib/db";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { eq, desc, and, isNotNull } from "drizzle-orm";

export const IMPROVEMENT_TOOL_NAMES = [
  "create_improvement_job",
  "get_improvement_job",
  "list_improvement_jobs",
  "update_improvement_job",
  "generate_training_data",
  "evaluate_model",
  "trigger_training",
  "get_training_status",
  "decide_optimization_target",
  "get_technique_knowledge",
  "record_technique_insight",
  "propose_architecture",
  "spawn_instance",
  "register_trained_model",
  "list_specialist_models",
] as const;

export async function handleImprovementTools(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined,
  executeToolRef?: ExecuteToolFn
): Promise<unknown> {
  switch (name) {
    case "create_improvement_job": {
      const id = crypto.randomUUID();
      await db
        .insert(improvementJobs)
        .values({
          id,
          name: typeof a.name === "string" ? a.name : null,
          scopeType: typeof a.scopeType === "string" ? a.scopeType : null,
          scopeId: typeof a.scopeId === "string" ? a.scopeId : null,
          studentLlmConfigId:
            typeof a.studentLlmConfigId === "string" ? a.studentLlmConfigId : null,
          teacherLlmConfigId:
            typeof a.teacherLlmConfigId === "string" ? a.teacherLlmConfigId : null,
          currentModelRef: null,
          instanceRefs: null,
          architectureSpec: null,
          lastTrainedAt: null,
          lastFeedbackAt: null,
          createdAt: Date.now(),
        })
        .run();
      return { id, message: "Improvement job created." };
    }
    case "get_improvement_job": {
      const jobId = a.id as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const r = rows[0];
      const instanceRefs = r.instanceRefs
        ? (() => {
            try {
              return JSON.parse(r.instanceRefs) as string[];
            } catch {
              return [];
            }
          })()
        : [];
      const architectureSpec = r.architectureSpec
        ? (() => {
            try {
              return JSON.parse(r.architectureSpec) as Record<string, unknown>;
            } catch {
              return undefined;
            }
          })()
        : undefined;
      return {
        id: r.id,
        name: r.name,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        studentLlmConfigId: r.studentLlmConfigId,
        teacherLlmConfigId: r.teacherLlmConfigId,
        currentModelRef: r.currentModelRef,
        instanceRefs,
        architectureSpec,
        lastTrainedAt: r.lastTrainedAt,
        lastFeedbackAt: r.lastFeedbackAt,
        createdAt: r.createdAt,
      };
    }
    case "list_improvement_jobs": {
      const rows = await db.select().from(improvementJobs).orderBy(desc(improvementJobs.createdAt));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        currentModelRef: r.currentModelRef,
        lastTrainedAt: r.lastTrainedAt,
      }));
    }
    case "update_improvement_job": {
      const jobId = a.id as string;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const updates: Record<string, unknown> = {};
      if (a.currentModelRef !== undefined) updates.currentModelRef = a.currentModelRef;
      if (Array.isArray(a.instanceRefs)) updates.instanceRefs = JSON.stringify(a.instanceRefs);
      if (a.architectureSpec != null && typeof a.architectureSpec === "object")
        updates.architectureSpec = JSON.stringify(a.architectureSpec);
      if (typeof a.lastTrainedAt === "number") updates.lastTrainedAt = a.lastTrainedAt;
      if (Object.keys(updates).length === 0) return { id: jobId, message: "No updates" };
      await db
        .update(improvementJobs)
        .set(updates as Record<string, unknown>)
        .where(eq(improvementJobs.id, jobId))
        .run();
      return { id: jobId, message: "Job updated." };
    }
    case "generate_training_data": {
      const strategy = (a.strategy as string) || "from_feedback";
      const scopeType = (a.scopeType as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const jobId = (a.jobId as string) || "";
      const since = typeof a.since === "number" ? a.since : undefined;
      const improvementDir = path.join(getDataDir(), "improvement");
      fs.mkdirSync(improvementDir, { recursive: true });

      if (strategy === "from_feedback") {
        const feedbackRows = await db
          .select()
          .from(feedback)
          .where(scopeId ? eq(feedback.targetId, scopeId) : isNotNull(feedback.id))
          .orderBy(desc(feedback.createdAt));
        const filtered = since ? feedbackRows.filter((f) => f.createdAt >= since) : feedbackRows;
        const slice = filtered.slice(0, 500);
        const filename = `from_feedback_${Date.now()}.jsonl`;
        const datasetRef = path.join(improvementDir, filename);
        const lines = slice.map((f) =>
          JSON.stringify({
            targetType: f.targetType,
            targetId: f.targetId,
            executionId: f.executionId,
            input: f.input,
            output: f.output,
            label: f.label,
            notes: f.notes,
            createdAt: f.createdAt,
          })
        );
        fs.writeFileSync(datasetRef, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
        return {
          datasetRef,
          strategy,
          count: slice.length,
          message: `Generated ${slice.length} feedback rows for training. Use datasetRef with trigger_training.`,
        };
      }

      if (strategy === "from_runs") {
        if (!scopeId) {
          return {
            error:
              "generate_training_data with strategy from_runs requires scopeId (agent or workflow id).",
          };
        }
        const runRows = await db
          .select()
          .from(executions)
          .where(eq(executions.targetId, scopeId))
          .orderBy(desc(executions.startedAt))
          .limit(100);
        const examples: Array<{
          runId: string;
          targetType: string;
          targetId: string;
          trail?: unknown;
          output?: unknown;
        }> = [];
        for (const row of runRows) {
          const runContext = await getRunForImprovement(row.id, { includeFullLogs: true });
          if ("error" in runContext) continue;
          examples.push({
            runId: runContext.id,
            targetType: runContext.targetType,
            targetId: runContext.targetId,
            trail: runContext.trail,
            output: runContext.output,
          });
        }
        const filename = `from_runs_${Date.now()}.jsonl`;
        const datasetRef = path.join(improvementDir, filename);
        const lines = examples.map((ex) => JSON.stringify(ex));
        fs.writeFileSync(datasetRef, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
        return {
          datasetRef,
          strategy,
          count: examples.length,
          message: `Generated ${examples.length} run trajectory examples. Use datasetRef with trigger_training.`,
        };
      }

      return {
        datasetRef: path.join(improvementDir, `${strategy}_${Date.now()}.jsonl`),
        strategy,
        message:
          "Dataset ref created; use trigger_training with this ref. Teacher/self_play require external data generation.",
      };
    }
    case "evaluate_model": {
      const jobId = (a.jobId as string)?.trim();
      if (!jobId) return { error: "evaluate_model requires jobId." };
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      const instanceRef = (a.instanceRef as string)?.trim() || null;
      const evalSetRef = (a.evalSetRef as string)?.trim() || null;
      const metrics = { accuracy: 0, loss: null as number | null };
      const evalId = crypto.randomUUID();
      await db
        .insert(evalResults)
        .values({
          id: evalId,
          jobId,
          trainingRunId: null,
          instanceRef,
          evalSetRef,
          metrics: JSON.stringify(metrics),
          createdAt: Date.now(),
        })
        .run();
      return {
        evalId,
        jobId,
        metrics,
        message:
          "Eval result persisted. Plug in eval set and run student for real metrics; then metrics will be stored in eval_results.",
      };
    }
    case "trigger_training": {
      const raw = a.jobId ?? a.job_id;
      const jobId = typeof raw === "string" ? raw.trim() : "";
      if (!jobId) {
        return {
          error:
            "trigger_training requires jobId. Create an improvement job with create_improvement_job first, then pass its id.",
        };
      }
      const jobRows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (jobRows.length === 0) {
        return { error: "Job not found" };
      }
      const datasetRef = (a.datasetRef as string) || "";
      const backend = (a.backend as string) || "local";
      const addInstance = !!a.addInstance;
      const experimentLabel =
        typeof a.experimentLabel === "string" ? a.experimentLabel.trim() : undefined;
      const runId = crypto.randomUUID();
      const localUrl = process.env.LOCAL_TRAINER_URL || "http://localhost:8765";
      const runConfig: { addInstance: boolean; experimentLabel?: string } = { addInstance };
      if (experimentLabel) runConfig.experimentLabel = experimentLabel;
      if (backend === "local") {
        try {
          const res = await fetch(`${localUrl}/train`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, datasetRef, runId }),
          });
          await res.json().catch(() => ({}));
          if (typeof jobId !== "string" || !jobId)
            return { error: "trigger_training requires a valid jobId." };
          await db
            .insert(trainingRuns)
            .values({
              id: runId,
              jobId,
              backend: "local",
              status: "pending",
              datasetRef,
              outputModelRef: null,
              config: JSON.stringify(runConfig),
              createdAt: Date.now(),
              finishedAt: null,
            })
            .run();
          return {
            runId,
            backend,
            status: "pending",
            message: `Training started. Poll get_training_status(runId: ${runId}) for completion.`,
          };
        } catch {
          if (typeof jobId !== "string" || !jobId)
            return { error: "trigger_training requires a valid jobId." };
          await db
            .insert(trainingRuns)
            .values({
              id: runId,
              jobId,
              backend: "local",
              status: "pending",
              datasetRef,
              outputModelRef: null,
              config: JSON.stringify(runConfig),
              createdAt: Date.now(),
              finishedAt: null,
            })
            .run();
          return {
            runId,
            backend,
            status: "pending",
            message: `Training run created (local trainer at ${localUrl} may be unavailable). Poll get_training_status(runId: ${runId}).`,
          };
        }
      }
      if (typeof jobId !== "string" || !jobId)
        return { error: "trigger_training requires a valid jobId." };
      await db
        .insert(trainingRuns)
        .values({
          id: runId,
          jobId,
          backend,
          status: "pending",
          datasetRef,
          outputModelRef: null,
          config: JSON.stringify(runConfig),
          createdAt: Date.now(),
          finishedAt: null,
        })
        .run();
      return {
        runId,
        backend,
        status: "pending",
        message: `Training run created. Poll get_training_status(runId: ${runId}) for replicate/huggingface.`,
      };
    }
    case "get_training_status": {
      const runId = (a.runId as string) || "";
      const rows = await db.select().from(trainingRuns).where(eq(trainingRuns.id, runId));
      if (rows.length === 0) return { error: "Run not found" };
      const r = rows[0];
      if (r.backend === "local" && (r.status === "pending" || r.status === "running")) {
        const localUrl = process.env.LOCAL_TRAINER_URL || "http://localhost:8765";
        try {
          const res = await fetch(`${localUrl}/status/${encodeURIComponent(runId)}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              status?: string;
              output_model_ref?: string | null;
              outputModelRef?: string | null;
            };
            const status = data.status ?? r.status;
            const outputModelRef = data.output_model_ref ?? data.outputModelRef ?? r.outputModelRef;
            const finishedAt =
              status === "completed" || status === "failed" ? Date.now() : r.finishedAt;
            await db
              .update(trainingRuns)
              .set({
                status,
                outputModelRef: outputModelRef ?? null,
                finishedAt,
              })
              .where(eq(trainingRuns.id, runId))
              .run();
            return {
              runId: r.id,
              status,
              outputModelRef: outputModelRef ?? null,
              finishedAt,
            };
          }
        } catch {
          // Trainer unreachable; return current DB state
        }
      }
      return {
        runId: r.id,
        status: r.status,
        outputModelRef: r.outputModelRef,
        finishedAt: r.finishedAt,
      };
    }
    case "decide_optimization_target": {
      const scopeType = (a.scopeType as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      return {
        target: "model_instance",
        scope: scopeType,
        reason:
          "Use model_instance to generate data and trigger training; use prompt when only instructions need change.",
        optionalSpec: null,
      };
    }
    case "get_technique_knowledge": {
      const jobId = (a.jobId as string) || "";
      const playbookRows = await db.select().from(techniquePlaybook);
      let playbook = playbookRows.map((p) => ({
        name: p.name,
        description: p.description,
        whenToUse: p.whenToUse,
        downsides: p.downsides,
      }));
      if (playbook.length === 0) {
        playbook = [
          {
            name: "Teacher distillation",
            description:
              "Use a stronger LLM to produce trajectories; train small model to imitate. Cold start before any RL.",
            whenToUse: "When the student has no prior agentic data.",
            downsides: "Requires teacher inference cost.",
          },
          {
            name: "LoRA/DoRA",
            description: "Low-rank adapters; only a small set of parameters updated.",
            whenToUse: "Prefer for add-instance and memory-constrained training.",
            downsides: "May underfit if rank too low.",
          },
          {
            name: "from_feedback",
            description: "Training data from user ratings (good/bad) and run outcomes.",
            whenToUse: "When you have feedback in the feedback table for the scope.",
            downsides: "Needs enough feedback; sparse signal.",
          },
          {
            name: "Contrastive",
            description: "Train on both positive and negative traces.",
            whenToUse: "When you have both good and bad runs.",
            downsides: "Can cause instability if feedback count is low.",
          },
          {
            name: "Multi-instance",
            description: "Spawn multiple instances; do not overwrite single model.",
            whenToUse: "To avoid capability collapse; specialization per tool/task.",
            downsides: "More compute and routing logic.",
          },
        ];
      }
      const insights = jobId
        ? await db
            .select()
            .from(techniqueInsights)
            .where(eq(techniqueInsights.jobId, jobId))
            .orderBy(desc(techniqueInsights.createdAt))
        : [];
      return {
        playbook,
        recentInsights: insights.slice(0, 10).map((i) => ({
          techniqueOrStrategy: i.techniqueOrStrategy,
          outcome: i.outcome,
          summary: i.summary,
        })),
      };
    }
    case "record_technique_insight": {
      const id = crypto.randomUUID();
      await db
        .insert(techniqueInsights)
        .values({
          id,
          jobId: (a.jobId as string) || "",
          runId: typeof a.runId === "string" ? a.runId : null,
          techniqueOrStrategy: (a.techniqueOrStrategy as string) || "",
          outcome: (a.outcome as string) || "neutral",
          summary: (a.summary as string) || "",
          config: a.config != null ? JSON.stringify(a.config) : null,
          createdAt: Date.now(),
        })
        .run();
      return { id, message: "Insight recorded." };
    }
    case "propose_architecture": {
      const raw = a.jobId ?? a.job_id;
      const jobId = typeof raw === "string" ? raw.trim() : "";
      if (!jobId)
        return {
          error:
            "propose_architecture requires jobId. Create an improvement job with create_improvement_job first.",
        };
      const spec = a.spec as Record<string, unknown>;
      const rows = await db.select().from(improvementJobs).where(eq(improvementJobs.id, jobId));
      if (rows.length === 0) return { error: "Job not found" };
      await db
        .update(improvementJobs)
        .set({ architectureSpec: JSON.stringify(spec || {}) })
        .where(eq(improvementJobs.id, jobId))
        .run();
      return {
        jobId,
        message:
          "Architecture spec attached to job. Next trigger_training will pass it to the backend if supported.",
      };
    }
    case "spawn_instance": {
      if (executeToolRef)
        return executeToolRef("trigger_training", { ...a, addInstance: true }, ctx);
      return { error: "spawn_instance requires executeTool ref" };
    }
    case "register_trained_model": {
      const outputModelRef = (a.outputModelRef as string)?.trim();
      if (!outputModelRef) return { error: "register_trained_model requires outputModelRef." };
      const id = `llm-trained-${crypto.randomUUID().slice(0, 8)}`;
      const row = toLlmConfigRow({
        id,
        provider: "local",
        model: outputModelRef,
        apiKeyRef: undefined,
        endpoint: undefined,
        extra: undefined,
      });
      await db.insert(llmConfigs).values(row).run();
      const jobId = (a.jobId as string)?.trim();
      return {
        llmConfigId: id,
        outputModelRef,
        message: `Registered as LLM config ${id}. Use update_improvement_job(currentModelRef or instanceRefs) or update_agent(llmConfigId) to attach.`,
        ...(jobId ? { jobId } : {}),
      };
    }
    case "list_specialist_models": {
      const agentId = (a.agentId as string)?.trim();
      if (!agentId) return { error: "list_specialist_models requires agentId." };
      const rows = await db
        .select()
        .from(improvementJobs)
        .where(and(eq(improvementJobs.scopeType, "agent"), eq(improvementJobs.scopeId, agentId)));
      const result = rows.map((r) => {
        const instanceRefs = r.instanceRefs
          ? (() => {
              try {
                return JSON.parse(r.instanceRefs) as string[];
              } catch {
                return [];
              }
            })()
          : [];
        return {
          jobId: r.id,
          jobName: r.name,
          currentModelRef: r.currentModelRef,
          instanceRefs,
          lastTrainedAt: r.lastTrainedAt,
        };
      });
      return { agentId, jobs: result };
    }
    default:
      return undefined;
  }
}
