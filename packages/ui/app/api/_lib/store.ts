type Store = {
  agents: Map<string, any>;
  workflows: Map<string, any>;
  llmProviders: Map<string, any>;
  tools: Map<string, any>;
  runs: Map<string, any>;
};

const getGlobalStore = (): Store => {
  const globalAny = globalThis as typeof globalThis & { __agentronStore?: Store };
  if (!globalAny.__agentronStore) {
    globalAny.__agentronStore = {
      agents: new Map(),
      workflows: new Map(),
      llmProviders: new Map(),
      tools: new Map(),
      runs: new Map()
    };
  }
  return globalAny.__agentronStore;
};

export const store = getGlobalStore();

export const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
