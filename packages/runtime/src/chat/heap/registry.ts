/**
 * Specialist registry: ids, per-specialist tool arrays, optional delegateTargets.
 * Caps: 10 tools per specialist, 7 top-level ids, 7 delegateTargets per delegator.
 */

export const SPECIALIST_TOOL_CAP = 10;
export const TOP_LEVEL_CAP = 7;
export const DELEGATE_TARGETS_CAP = 7;

/** Structured option group for querying the heap: label + tool ids in that group. */
export interface SpecialistOptionGroup {
  label: string;
  toolIds: string[];
}

export interface SpecialistEntry {
  id: string;
  /** Tool names this specialist can use (max SPECIALIST_TOOL_CAP). */
  toolNames: string[];
  /** Optional: specialist ids this one can delegate to (max DELEGATE_TARGETS_CAP). */
  delegateTargets?: string[];
  /** Optional one-line description for router/delegator prompts. */
  description?: string;
  /** Optional: structured option groups so callers query by intent/phase instead of judging a flat tool list. */
  optionGroups?: Record<string, SpecialistOptionGroup>;
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
  /** Optional: structured option groups (observe, act_prompt, etc.) so planner/improver query heap by intent. */
  optionGroups?: Record<string, SpecialistOptionGroup>;
  /** Optional: when chunked into N parts, use partIds[i] as leaf id instead of ${id}__part${i+1}. Must satisfy partIds[i].startsWith(id + "_"). */
  partIds?: string[];
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
  specialists: Record<string, SpecialistEntry>,
  optionGroups?: Record<string, SpecialistOptionGroup>
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
    optionGroups,
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
    const { id, description, toolNames, optionGroups, partIds } = spec;
    const chunks = chunkArray(toolNames, SPECIALIST_TOOL_CAP);

    if (chunks.length === 0) {
      specialists[id] = { id, description, toolNames: [], optionGroups };
      continue;
    }

    if (chunks.length === 1) {
      specialists[id] = { id, description, toolNames: chunks[0], optionGroups };
      continue;
    }

    // Build leaf specialists with tools. Use partIds when length matches and prefix is correct.
    const leafIds: string[] = [];
    const prefix = id + "_";
    chunks.forEach((chunk, index) => {
      const leafId =
        partIds && partIds.length === chunks.length && partIds[index]?.startsWith(prefix)
          ? partIds[index]!
          : `${id}__part${index + 1}`;
      leafIds.push(leafId);
      specialists[leafId] = {
        id: leafId,
        description: description ? `${description} (part ${index + 1})` : undefined,
        toolNames: chunk,
      };
    });

    // Build delegator hierarchy above the leaf specialists; root holds optionGroups for querying.
    addDelegatorHierarchy(id, description, leafIds, specialists, optionGroups);
  }

  const logicalTopLevel =
    topLevelIds && topLevelIds.length > 0 ? topLevelIds : specs.map((s) => s.id);
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
      description:
        "Workflows: list, get, create, update, execute, get run, cancel, respond, list versions, rollback; ask_user when asking which workflow to run/update; format_response when presenting next-step options so the user gets clickable choices.",
      toolNames: [
        "list_workflows",
        "get_workflow",
        "create_workflow",
        "update_workflow",
        "add_workflow_edges",
        "list_workflow_versions",
        "rollback_workflow",
        "execute_workflow",
        "get_run",
        "cancel_run",
        "respond_to_run",
        "ask_user",
        "format_response",
      ],
    },
    // Improvement specialists by purpose: (a) current run only, (b) heap, (c) workflow agents/workflows.
    // (a) improve_run: current run/session only; no DB. (b) improve_heap: registry, planner. (c) improve_agents_workflows: workflow agents and workflows in studio DB.
    {
      id: "improve_run",
      description:
        "Improve current Agentron run/session only. Observe run/feedback, suggest prompt or workflow tweaks, apply_session_override for this run/session; no DB writes. Use when user wants to fix or preview changes for the current run only.",
      toolNames: [
        "get_run_for_improvement",
        "get_feedback_for_scope",
        "get_agent",
        "get_workflow",
        "format_response",
        "ask_user",
        "apply_session_override",
      ],
    },
    {
      id: "improve_heap",
      description:
        "Improve the heap (registry, planner; add/change specialists). Use get_specialist_options to query; register_specialist, update_specialist, list_specialists. Does not change workflow agents or workflows.",
      toolNames: [
        "get_specialist_options",
        "register_specialist",
        "update_specialist",
        "list_specialists",
        "ask_user",
      ],
    },
    {
      id: "improve_agents_workflows",
      description:
        "Improve workflow agents and workflows (studio DB). Use when user wants to improve from a run/feedback, fix a failed run, or design self-learning. Observe (get_run_for_improvement, get_feedback_for_scope), then act (update_agent, update_workflow, training pipeline). Does not create agents or workflows; only updates existing ones.",
      optionGroups: {
        observe: {
          label: "Observe run and feedback",
          toolIds: ["get_run_for_improvement", "get_feedback_for_scope"],
        },
        act_prompt: {
          label: "Adjust prompts (update_agent, apply_agent_prompt_improvement)",
          toolIds: [
            "get_agent",
            "update_agent",
            "apply_agent_prompt_improvement",
            "list_agent_versions",
            "rollback_agent",
          ],
        },
        act_topology: {
          label: "Adjust workflow/agent graph",
          toolIds: [
            "get_workflow",
            "update_workflow",
            "update_agent",
            "list_workflows",
            "list_workflow_versions",
            "rollback_workflow",
          ],
        },
        act_training: {
          label: "Training pipeline (jobs, generate data, trigger training)",
          toolIds: [
            "create_improvement_job",
            "get_improvement_job",
            "list_improvement_jobs",
            "update_improvement_job",
            "generate_training_data",
            "trigger_training",
            "get_training_status",
            "evaluate_model",
            "decide_optimization_target",
            "get_technique_knowledge",
            "record_technique_insight",
            "propose_architecture",
            "spawn_instance",
          ],
        },
        evaluate: {
          label: "Re-run or ask user (Done/Retry)",
          toolIds: ["execute_workflow", "ask_user"],
        },
      },
      toolNames: [
        "get_specialist_options",
        "get_run_for_improvement",
        "get_feedback_for_scope",
        "get_agent",
        "update_agent",
        "apply_agent_prompt_improvement",
        "list_agent_versions",
        "rollback_agent",
        "get_workflow",
        "update_workflow",
        "list_workflows",
        "list_workflow_versions",
        "rollback_workflow",
        "execute_workflow",
        "list_agents",
        "list_tools",
        "create_improvement_job",
        "get_improvement_job",
        "list_improvement_jobs",
        "update_improvement_job",
        "generate_training_data",
        "trigger_training",
        "get_training_status",
        "evaluate_model",
        "decide_optimization_target",
        "get_technique_knowledge",
        "record_technique_insight",
        "propose_architecture",
        "spawn_instance",
        "create_tool",
        "update_tool",
        "ask_user",
      ],
    },
    {
      id: "agent",
      description:
        "Agents: list, create, get, update, delete, versions, rollback, list tools, LLM providers; and OpenClaw instance (send commands, history, abort) when an agent runs or steers OpenClaw.",
      toolNames: [
        "list_agents",
        "list_tools",
        "create_agent",
        "get_agent",
        "update_agent",
        "delete_agent",
        "list_agent_versions",
        "rollback_agent",
        "list_llm_providers",
        "ask_user",
        "send_to_openclaw",
        "openclaw_history",
        "openclaw_abort",
      ],
      partIds: ["agent_lifecycle", "agent_openclaw"],
      optionGroups: {
        agent_lifecycle: {
          label: "Agent CRUD, versions, rollback, LLM providers",
          toolIds: [
            "list_agents",
            "list_tools",
            "create_agent",
            "get_agent",
            "update_agent",
            "delete_agent",
            "list_agent_versions",
            "rollback_agent",
            "list_llm_providers",
            "ask_user",
          ],
        },
        openclaw: {
          label: "OpenClaw instance (send, history, abort)",
          toolIds: ["send_to_openclaw", "openclaw_history", "openclaw_abort"],
        },
      },
    },
    {
      id: "tools",
      description:
        "Create and improve tools (HTTP, MCP, code). List/get/update tools; create_code_tool for new code tools; list/get/update_custom_function to read or change tool source. Use when the user wants to add a tool, implement a capability as a tool, or fix/improve an existing code tool.",
      toolNames: [
        "list_tools",
        "get_tool",
        "create_tool",
        "update_tool",
        "create_code_tool",
        "list_custom_functions",
        "get_custom_function",
        "update_custom_function",
      ],
    },
    {
      id: "planner",
      description:
        "Planner: outputs structured plan (priorityOrder, refinedTask, extractedContext, instructionsFor*); no DB tools",
      toolNames: [],
    },
  ];

  return buildRegistryFromSpecs(specs, [
    "general",
    "workflow",
    "agent",
    "tools",
    "improve_run",
    "improve_heap",
    "improve_agents_workflows",
  ]);
}

let defaultRegistry: SpecialistRegistry | null = null;

/**
 * Merge overlay specialist entries into a registry. Override entries replace or add by id;
 * new ids are appended to topLevelIds up to TOP_LEVEL_CAP.
 */
export function mergeRegistryOverrides(
  registry: SpecialistRegistry,
  overrides: SpecialistEntry[]
): SpecialistRegistry {
  const specialists = { ...registry.specialists };
  let topLevelIds = [...registry.topLevelIds];
  for (const entry of overrides) {
    specialists[entry.id] = { ...entry, toolNames: entry.toolNames.slice(0, SPECIALIST_TOOL_CAP) };
    if (!topLevelIds.includes(entry.id) && topLevelIds.length < TOP_LEVEL_CAP) {
      topLevelIds = [...topLevelIds, entry.id];
    }
  }
  return { topLevelIds, specialists };
}

/**
 * Returns the specialist registry. Supports (a) static default, (b) full override, (c) overlay entries from heap improver.
 * Pass overrides from persisted store (e.g. .data/specialist_overrides.json) to merge custom specialists.
 */
export function getRegistry(
  override?: SpecialistRegistry | (() => SpecialistRegistry) | SpecialistEntry[]
): SpecialistRegistry {
  if (override !== undefined) {
    if (Array.isArray(override)) {
      return applyRegistryCaps(mergeRegistryOverrides(buildDefaultRegistry(), override));
    }
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

/**
 * Returns the parent top-level id if this id is a subspecialist (e.g. improve_agents_workflows__part1 → improve_agents_workflows).
 * An id is a subspecialist when another topLevelId P exists such that id.startsWith(P + "_").
 */
export function getSubspecialistParent(id: string, registry: SpecialistRegistry): string | null {
  for (const p of registry.topLevelIds) {
    if (p !== id && id.startsWith(p + "_")) return p;
  }
  return null;
}

/**
 * Top-level ids that are not subspecialists of another top-level (i.e. root-level entry points for the heap).
 * Used by getOptionsAtNode(null) so the model sees only primary choices at the root.
 */
export function getPrimaryTopLevelIds(registry: SpecialistRegistry): string[] {
  return registry.topLevelIds.filter((id) => getSubspecialistParent(id, registry) === null);
}

/** Serializable heap snapshot for docs and UI (same shape as GET /api/heap). */
export interface HeapSnapshot {
  topLevelIds: string[];
  specialists: Array<{
    id: string;
    description?: string;
    toolNames: string[];
    delegateTargets?: string[];
    optionGroups?: Record<string, { label: string; toolIds: string[] }>;
  }>;
  overlayIds: string[];
}

/**
 * Build snapshot from a registry. Order: topLevelIds first, then all other specialist ids.
 */
export function registryToSnapshot(
  registry: SpecialistRegistry,
  overlayIds: string[] = []
): HeapSnapshot {
  const topSet = new Set(registry.topLevelIds);
  const specialists = [
    ...registry.topLevelIds.map((id) => {
      const entry = registry.specialists[id];
      if (!entry) return null;
      return {
        id,
        description: entry.description,
        toolNames: entry.toolNames ?? [],
        delegateTargets: entry.delegateTargets,
        optionGroups: entry.optionGroups
          ? Object.fromEntries(
              Object.entries(entry.optionGroups).map(([k, v]) => [
                k,
                { label: v.label, toolIds: v.toolIds ?? [] },
              ])
            )
          : undefined,
      };
    }),
    ...Object.entries(registry.specialists)
      .filter(([id]) => !topSet.has(id))
      .map(([id, entry]) => ({
        id,
        description: entry.description,
        toolNames: entry.toolNames ?? [],
        delegateTargets: entry.delegateTargets,
        optionGroups: entry.optionGroups
          ? Object.fromEntries(
              Object.entries(entry.optionGroups).map(([k, v]) => [
                k,
                { label: v.label, toolIds: v.toolIds ?? [] },
              ])
            )
          : undefined,
      })),
  ].filter((x): x is NonNullable<typeof x> => x != null);
  return { topLevelIds: registry.topLevelIds, specialists, overlayIds };
}

/** Default production heap snapshot (no overrides). Use for docs and static export. */
export function getDefaultHeapSnapshot(): HeapSnapshot {
  return registryToSnapshot(getRegistry(), []);
}

/**
 * Child specialist ids for a node: delegateTargets from registry, or subspecialists (topLevelIds whose parent is this id).
 * Used for recursive search so the model only sees ≤ optionsCap choices at each level.
 * Time: O(|topLevelIds|) when using subspecialist convention; O(1) when delegateTargets present.
 */
export function getChildSpecialistIds(id: string, registry: SpecialistRegistry): string[] {
  const entry = registry.specialists[id];
  if (entry?.delegateTargets && entry.delegateTargets.length > 0) {
    return entry.delegateTargets.filter((c) => c in registry.specialists);
  }
  return registry.topLevelIds.filter((cid) => getSubspecialistParent(cid, registry) === id);
}

/**
 * Effective tool names for a specialist. For a leaf (has toolNames), returns that list.
 * For a delegator (has delegateTargets, empty toolNames), returns the union of tools from all delegate leaves.
 * Use this when running a specialist so delegators (e.g. workflow with workflow__part1, workflow__part2) allow all tools from their parts.
 */
export function getToolsForSpecialist(
  registry: SpecialistRegistry,
  specialistId: string
): string[] {
  const entry = registry.specialists[specialistId];
  if (!entry) return [];
  if (entry.toolNames.length > 0) return entry.toolNames;
  if (entry.delegateTargets && entry.delegateTargets.length > 0) {
    const union = new Set<string>();
    for (const childId of entry.delegateTargets) {
      for (const tool of getToolsForSpecialist(registry, childId)) union.add(tool);
    }
    return [...union];
  }
  return [];
}

/** Max options to show per level (router/planner cap). */
export const HEAP_OPTIONS_CAP = 10;

/**
 * Options at a node for recursive search: at root (nodeId null) returns primary top-level; else returns children of node.
 * Capped at HEAP_OPTIONS_CAP so the model never sees more than 10 choices.
 * Time: O(|topLevelIds|) per call. With fixed depth limit, full path search is O(|topLevelIds|) = O(n).
 */
export function getOptionsAtNode(
  registry: SpecialistRegistry,
  nodeId: string | null,
  optionsCap = HEAP_OPTIONS_CAP
): string[] {
  const raw =
    nodeId === null ? getPrimaryTopLevelIds(registry) : getChildSpecialistIds(nodeId, registry);
  return raw.slice(0, optionsCap);
}

/** Result of querying the heap for structured options (so planner/improver use option groups, not a flat tool list). */
export interface SpecialistOptionsResult {
  specialistId: string;
  description?: string;
  optionGroups: Record<string, SpecialistOptionGroup>;
}

/**
 * Query the heap for structured options for one or all specialists. Returns option groups (observe, act_prompt, etc.)
 * so the improver/planner can judge meaning and choose groups instead of judging a full tool list.
 */
export function getSpecialistOptions(
  registry: SpecialistRegistry,
  specialistId?: string
): SpecialistOptionsResult[] {
  const ids = specialistId != null ? [specialistId] : registry.topLevelIds;
  const result: SpecialistOptionsResult[] = [];
  for (const id of ids) {
    const entry = registry.specialists[id];
    if (!entry) continue;
    const toolIds = getToolsForSpecialist(registry, id);
    const optionGroups = entry.optionGroups ?? {
      default: { label: entry.description ?? id, toolIds },
    };
    result.push({ specialistId: id, description: entry.description, optionGroups });
  }
  return result;
}
