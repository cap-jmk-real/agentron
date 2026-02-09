import type { LocalLLMSetupPlan } from "./types";

export const defaultLocalSetupPlan = (): LocalLLMSetupPlan => ({
  runtime: "ollama",
  endpoint: "http://localhost:11434",
  model: "llama3.1:8b"
});

export const buildCustomSetupPlan = (
  endpoint: string,
  model: string,
  runtime: LocalLLMSetupPlan["runtime"] = "ollama"
): LocalLLMSetupPlan => ({
  runtime,
  endpoint,
  model
});
