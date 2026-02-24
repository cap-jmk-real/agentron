export type LocalRuntimeKind = "ollama" | "lmstudio" | "localai" | "vllm" | "llama_cpp";

export type DetectedRuntime = {
  kind: LocalRuntimeKind;
  endpoint: string;
  healthy: boolean;
};

export type LocalLLMSetupPlan = {
  runtime: LocalRuntimeKind;
  endpoint: string;
  model: string;
};
