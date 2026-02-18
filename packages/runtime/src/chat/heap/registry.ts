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

/**
 * Logical specialist specification before caps and hierarchy are applied.
 * One logical id may expand into multiple concrete specialists when tool caps are exceeded.
 */
export interface LogicalSpecialistSpec {
  id: string;
  description?: string;
  toolNames: string[];
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

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function addDelegatorHierarchy(
  rootId: string,
  description: string | undefined,
  leafIds: string[],
  specialists: Record<string, SpecialistEntry>
): void {
  let currentChildren = [...leafIds];
  let level = 1;

  // Build intermediate delegators until the root can point to <= DELEGATE_TARGETS_CAP children.
  while (currentChildren.length > DELEGATE_TARGETS_CAP) {
    const nextLevel: string[] = [];
    const groups = chunkArray(currentChildren, DELEGATE_TARGETS_CAP);
    groups.forEach((group, index) => {
      const groupId = `${rootId}__lvl${level}_group${index + 1}`;
      // Avoid accidental overwrite; if collision occurs, last one wins but ids should be unique in practice.
      specialists[groupId] = {
        id: groupId,
        description: description ? `${description} (group ${level}.${index + 1})` : undefined,
        toolNames: [],
        delegateTargets: [...group],
      };
      nextLevel.push(groupId);
    });
    currentChildren = nextLevel;
    level += 1;
  }

  specialists[rootId] = {
    id: rootId,
    description,
    toolNames: [],
    delegateTargets: currentChildren,
  };
}

/**
 * Builds a SpecialistRegistry from logical specs, automatically creating
 * multi-level specialist hierarchies when a logical specialist has more
 * than SPECIALIST_TOOL_CAP tools.
 *
 * - If toolNames.length <= SPECIALIST_TOOL_CAP: one specialist with that id.
 * - If toolNames.length > SPECIALIST_TOOL_CAP:
 *   - Create leaf specialists `${id}__partN` each with <= SPECIALIST_TOOL_CAP tools.
 *   - Create delegator(s) with no tools and delegateTargets pointing at children,
 *     respecting DELEGATE_TARGETS_CAP via intermediate delegators if needed.
 *
 * topLevelIds are expressed in terms of logical ids; the resulting registry
 * keeps those ids at the top level (the delegators), never the internal parts.
 */
export function buildRegistryFromSpecs(
  specs: LogicalSpecialistSpec[],
  topLevelIds?: string[]
): SpecialistRegistry {
  const specialists: Record<string, SpecialistEntry> = {};

  for (const spec of specs) {
    const { id, description, toolNames } = spec;
    const chunks = chunkArray(toolNames, SPECIALIST_TOOL_CAP);

    if (chunks.length === 0) {
      specialists[id] = { id, description, toolNames: [] };
      continue;
    }

    if (chunks.length === 1) {
      specialists[id] = { id, description, toolNames: chunks[0] };
      continue;
    }

    // Build leaf specialists with tools.
    const leafIds: string[] = [];
    chunks.forEach((chunk, index) => {
      const leafId = `${id}__part${index + 1}`;
      leafIds.push(leafId);
      specialists[leafId] = {
        id: leafId,
        description: description ? `${description} (part ${index + 1})` : undefined,
        toolNames: chunk,
      };
    });

    // Build delegator hierarchy above the leaf specialists.
    addDelegatorHierarchy(id, description, leafIds, specialists);
  }

  const logicalTopLevel = topLevelIds && topLevelIds.length > 0 ? topLevelIds : specs.map((s) => s.id);
  const resolvedTopLevel = logicalTopLevel.filter((id) => id in specialists);

  return applyRegistryCaps({
    topLevelIds: resolvedTopLevel,
    specialists,
  });
}

/** Default static registry. Can be replaced later by DB-backed getRegistry. */
function buildDefaultRegistry(): SpecialistRegistry {
  const specs: LogicalSpecialistSpec[] = [
    {
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
    {
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
    {
      id: "improvement",
      description: "Improvement: get run for improvement, feedback for scope, update agent/tool, ask user when presenting choices",
      toolNames: [
        "get_run_for_improvement",
        "get_feedback_for_scope",
        "update_agent",
        "create_agent",
        "create_tool",
        "update_tool",
        "ask_user",
      ],
    },
    {
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
  ];

  return buildRegistryFromSpecs(specs, ["general", "workflow", "improvement", "agent"]);
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
