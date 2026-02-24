import type { DetectedRuntime } from "./types";

const tryEndpoint = async (endpoint: string, path = "/v1/models") => {
  try {
    const response = await fetch(`${endpoint}${path}`);
    return response.ok;
  } catch {
    return false;
  }
};

export const detectLocalRuntimes = async (): Promise<DetectedRuntime[]> => {
  const candidates: Array<DetectedRuntime> = [
    { kind: "ollama", endpoint: "http://localhost:11434", healthy: false },
    { kind: "lmstudio", endpoint: "http://localhost:1234", healthy: false },
    { kind: "localai", endpoint: "http://localhost:8080", healthy: false },
    { kind: "vllm", endpoint: "http://localhost:8000", healthy: false },
    { kind: "llama_cpp", endpoint: "http://localhost:8081", healthy: false },
  ];

  const results = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      healthy: await tryEndpoint(candidate.endpoint),
    }))
  );

  return results;
};
