/**
 * Specialist registry: ids, per-specialist tool arrays, optional delegateTargets.
 * Caps: 10 tools per specialist, 7 top-level ids, 7 delegateTargets per delegator.
 */

export const SPECIALIST_TOOL_CAP = 10;
export const TOP_LEVEL_CAP = 7;
export const DELEGATE_TARGETS_CAP = 7;

export interface SpecialistEntry {
  id: string;
  /** Tool names this specialist can use (max SPECIALIST_TOOL_CAP). */
  toolNames: string[];
  /** Optional: specialist ids this one can delegate to (max DELEGATE_TARGETS_CAP). */
  delegateTargets?: string[];
  /** Optional one-line description for router/delegator prompts. */
  description?: string;
}

export interface SpecialistRegistry {
  /** Top-level specialist ids for the router (max TOP_LEVEL_CAP). */
  topLevelIds: string[];
  /** Map specialist id -> entry. */
  specialists: Record<string, SpecialistEntry>;
}

/** Validates and trims arrays to caps. */
export function applyRegistryCaps(reg: SpecialistRegistry): SpecialistRegistry {
  const topLevelIds = reg.topLevelIds.slice(0, TOP_LEVEL_CAP);
  const specialists: Record<string, SpecialistEntry> = {};
  for (const [id, entry] of Object.entries(reg.specialists)) {
    specialists[id] = {
      ...entry,
      toolNames: entry.toolNames.slice(0, SPECIALIST_TOOL_CAP),
      delegateTargets: entry.delegateTargets?.slice(0, DELEGATE_TARGETS_CAP),
    };
  }
  return { topLevelIds, specialists };
}

/** Default static registry. Can be replaced later by DB-backed getRegistry. */
function buildDefaultRegistry(): SpecialistRegistry {
  return applyRegistryCaps({
    topLevelIds: ["general", "workflow", "improvement", "agent"],
    specialists: {
      general: {
        id: "general",
        description: "Conversation, ask user, format response, remember, list agents/tools",
        toolNames: [
          "ask_user",
          "format_response",
          "remember",
          "list_agents",
          "list_tools",
          "get_agent",
          "list_workflows",
        ],
      },
      workflow: {
        id: "workflow",
        description: "Workflows: list, get, create, update, execute, get run, cancel, respond",
        toolNames: [
          "list_workflows",
          "get_workflow",
          "create_workflow",
          "update_workflow",
          "add_workflow_edges",
          "execute_workflow",
          "get_run",
          "cancel_run",
          "respond_to_run",
        ],
      },
      improvement: {
        id: "improvement",
        description: "Improvement: get run for improvement, feedback for scope, update agent/tool",
        toolNames: [
          "get_run_for_improvement",
          "get_feedback_for_scope",
          "update_agent",
          "create_agent",
          "create_tool",
          "update_tool",
        ],
      },
      agent: {
        id: "agent",
        description: "Agents: list, create, get, update, delete, list LLM providers",
        toolNames: [
          "list_agents",
          "create_agent",
          "get_agent",
          "update_agent",
          "delete_agent",
          "list_llm_providers",
        ],
      },
    },
  });
}

let defaultRegistry: SpecialistRegistry | null = null;

/**
 * Returns the specialist registry. Current phase: static default.
 * Later: allow injectable getRegistry (e.g. from DB) so improver can register new specialists.
 */
export function getRegistry(override?: SpecialistRegistry | (() => SpecialistRegistry)): SpecialistRegistry {
  if (override !== undefined) {
    if (typeof override === "function") {
      return applyRegistryCaps(override());
    }
    return applyRegistryCaps(override);
  }
  if (!defaultRegistry) {
    defaultRegistry = buildDefaultRegistry();
  }
  return defaultRegistry;
}
