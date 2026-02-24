import type { AssistantToolDef } from "./types";

/**
 * Improvement tools (§2.0.1). The chat composes these into agents/workflows so the user
 * can design an "improvement agent" (e.g. one that generates training data, triggers training,
 * evaluates models) without a fixed structure.
 */
export const IMPROVEMENT_TOOLS: AssistantToolDef[] = [
  {
    name: "create_improvement_job",
    description:
      "Create an improvement job to track a model to improve. Used when building an agent that improves a small LLM from feedback or runs training. Returns job id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Optional job name" },
        scopeType: {
          type: "string",
          enum: ["agent", "workflow", "job"],
          description: "Scope type",
        },
        scopeId: { type: "string", description: "Agent id, workflow id, or leave empty" },
        studentLlmConfigId: {
          type: "string",
          description: "LLM config for the student (small) model",
        },
        teacherLlmConfigId: {
          type: "string",
          description: "Optional LLM config for teacher (distillation)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_improvement_job",
    description: "Get an improvement job by id (current model ref, instances, last trained, etc.).",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Job id" } },
      required: ["id"],
    },
  },
  {
    name: "list_improvement_jobs",
    description: "List all improvement jobs. Use to inspect or choose which job to work on.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_improvement_job",
    description:
      "Update an improvement job (e.g. current model ref, instance refs, architecture spec) after training completes or when scope changes.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        currentModelRef: { type: "string" },
        instanceRefs: { type: "array", items: { type: "string" } },
        architectureSpec: {
          type: "object",
          description: "Optional architecture spec for train-from-spec",
        },
        lastTrainedAt: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "generate_training_data",
    description:
      "Generate training dataset for model improvement. Strategies: from_feedback (user ratings → SFT/preference), teacher (distillation from stronger model), self_play, contrastive. Returns dataset ref (path or id) and summary. Use before trigger_training.",
    parameters: {
      type: "object",
      properties: {
        strategy: {
          type: "string",
          enum: ["from_feedback", "from_runs", "teacher", "self_play", "contrastive"],
          description: "Data strategy",
        },
        scopeType: { type: "string", enum: ["agent", "workflow", "improvement_job"] },
        scopeId: { type: "string", description: "targetId or jobId" },
        since: {
          type: "number",
          description: "Optional timestamp: only include feedback/runs after this",
        },
        jobId: { type: "string", description: "Improvement job id when scope is improvement_job" },
      },
      required: ["strategy"],
    },
  },
  {
    name: "evaluate_model",
    description:
      "Run the student (or a given instance) on an eval set; return metrics. Use to check if improvement is good enough or to compare instances.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        instanceRef: { type: "string", description: "Optional; omit to use job's current model" },
        evalSetRef: {
          type: "string",
          description: "Optional ref to eval set from a store or path",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "trigger_training",
    description:
      "Start a training run. Backend: local (HTTP trainer), replicate, or huggingface. Pass dataset ref from generate_training_data. Use addInstance: true to spawn a new instance without replacing current.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        datasetRef: { type: "string", description: "Path or id from generate_training_data" },
        backend: {
          type: "string",
          enum: ["local", "replicate", "huggingface"],
          description: "Training backend",
        },
        addInstance: {
          type: "boolean",
          description: "If true, create new instance without replacing current",
        },
        experimentLabel: {
          type: "string",
          description:
            "Optional label for experiment tracking (stored in run config for filtering)",
        },
        config: { type: "object", description: "Optional hyperparams (epochs, lr, etc.)" },
      },
      required: ["jobId", "datasetRef", "backend"],
    },
  },
  {
    name: "get_training_status",
    description:
      "Poll a training run; returns status (pending/running/completed/failed) and output model ref when done. Use after trigger_training to wait for completion then update_improvement_job.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Training run id from trigger_training" },
      },
      required: ["runId"],
    },
  },
  {
    name: "decide_optimization_target",
    description:
      "Given scope (job/agent/tool), returns what to optimize: prompt, model_instance, or architecture, with reason. Use to branch: prompt → update_agent/update_tool; model_instance → generate_training_data + trigger_training; architecture → propose_architecture + trigger_training.",
    parameters: {
      type: "object",
      properties: {
        scopeType: { type: "string", enum: ["job", "agent", "tool"] },
        scopeId: { type: "string" },
      },
      required: ["scopeType", "scopeId"],
    },
  },
  {
    name: "get_technique_knowledge",
    description:
      "Return the technique playbook (LoRA, distillation, contrastive, etc.): what each is, when to use, downsides. Optionally include recent insights for a job. Call when designing improvement flow to pick the right technique.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Optional; include recent insights for this job" },
      },
      required: [],
    },
  },
  {
    name: "record_technique_insight",
    description:
      "Store an insight after a run (e.g. 'teacher distillation helped', 'contrastive caused instability'). Future get_technique_knowledge for same job includes these.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        runId: { type: "string" },
        techniqueOrStrategy: { type: "string" },
        outcome: { type: "string", enum: ["helpful", "neutral", "harmful"] },
        summary: { type: "string" },
      },
      required: ["jobId", "techniqueOrStrategy", "outcome", "summary"],
    },
  },
  {
    name: "propose_architecture",
    description:
      "Attach an architecture spec to a job or next training run (e.g. reduce layers, change hidden size). trigger_training will pass it to the backend when train-from-spec is supported.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        spec: { type: "object", description: "e.g. { layers, hiddenSize, attentionHeads }" },
      },
      required: ["jobId", "spec"],
    },
  },
  {
    name: "spawn_instance",
    description:
      "Create a new model instance without replacing current (multi-instance specialization). Same as trigger_training with addInstance: true; optionally tag for tool or scope.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        datasetRef: { type: "string" },
        backend: { type: "string", enum: ["local", "replicate", "huggingface"] },
        tag: { type: "string", description: "Optional tag e.g. 'code', 'browser'" },
      },
      required: ["jobId", "datasetRef", "backend"],
    },
  },
  {
    name: "register_trained_model",
    description:
      "Register a trained model (outputModelRef from get_training_status) as an LLM config so agents can use it. Returns llmConfigId; then update_improvement_job (currentModelRef or instanceRefs) or update_agent (llmConfigId).",
    parameters: {
      type: "object",
      properties: {
        outputModelRef: {
          type: "string",
          description: "Path or Ollama model name from training run output",
        },
        name: {
          type: "string",
          description: "Optional label for the config (e.g. improved-agent-xyz)",
        },
        jobId: { type: "string", description: "Optional; link to improvement job" },
      },
      required: ["outputModelRef"],
    },
  },
  {
    name: "list_specialist_models",
    description:
      "List specialist model instances for an agent (improvement jobs scoped to that agent; returns currentModelRef and instanceRefs resolved to LLM config ids).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent id to list specialist models for" },
      },
      required: ["agentId"],
    },
  },
];
