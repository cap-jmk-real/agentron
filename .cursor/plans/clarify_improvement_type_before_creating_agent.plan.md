---
name: ""
overview: ""
todos: []
isProject: false
---

# Clarify improvement mechanism(s) before creating self-improving agents (classical path only)

## Scope: classical assistant only

**The failure to ask which improvement type the user wanted only happened with the classical (non-heap) assistant.** The heap agent specialist already receives the improvement clarification and did well; no change is needed for the heap path regarding *where* the clarification is applied.

- **Heap mode** (`useHeapMode === true`): The **agent** specialist gets `agentCreationBlock` in [packages/ui/app/api/chat/route.ts](packages/ui/app/api/chat/route.ts) (inside `runSpecialistInner`), which includes `AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION`. So when the user asks for a self-improving agent in heap mode, the agent specialist is instructed to call `ask_user` first. **Leave this behavior as-is** (optionally improve the *wording* of the clarification to list four mechanisms).
- **Classical mode** (`useHeapMode === false`): The single `runAssistant` call uses `SYSTEM_PROMPT` from the runtime (or the user’s custom system prompt). The improvement clarification is **not** injected anywhere for this path, so the classical assistant was never instructed to ask. **Fix:** inject the same improvement clarification into the classical assistant’s system prompt so it also asks before creating a self-improving agent.

## Problem

When a user asked for a self-improving or self-learning agent in **classical** mode, the assistant created an agent (e.g. with training tools) without asking which improvement mechanism(s) they wanted. The four distinct mechanisms are:

1. **Workflow topology** — change edges, add/remove agents (subset `topology`).
2. **Agent improvement** — change which tools agents use and their prompts (`update_agent`, etc.; part of `prompt` / `topology`).
3. **Prompt improvement** — refine system prompts from feedback via `apply_agent_prompt_improvement` (subset `prompt`).
4. **Model finetuning** — improvement jobs, generate_training_data, trigger_training, etc. (subset `training`).

The user should be asked to choose which of these they want before the assistant creates an agent and attaches improvement tools.

## Current behavior

- **Classical:** [packages/ui/app/api/chat/route.ts](packages/ui/app/api/chat/route.ts) calls `runAssistant(history, effectiveMessage, { ..., systemPromptOverride, ... })`. When `systemPromptOverride` is undefined, the runtime uses `SYSTEM_PROMPT` from [packages/runtime/src/chat/tools/prompt.ts](packages/runtime/src/chat/tools/prompt.ts). Neither includes `AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION`.
- **Heap:** Same route builds `agentCreationBlock` (including `AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION`) only when `specialistId === "agent"` inside `runHeapModeTurn`; the agent specialist therefore gets the rule. No change needed for heap application point.

## Proposed changes

### 1. Inject improvement clarification into the classical assistant path

**File:** [packages/ui/app/api/chat/route.ts](packages/ui/app/api/chat/route.ts)

- When calling `runAssistant` for the **classical** path (the branch where `useHeapMode` is false), ensure the system prompt includes the improvement clarification. For example:
  - Compute an effective system prompt for classical: `(systemPromptOverride ?? defaultPrompt) + (improvement clarification paragraph)`.
  - Pass that as `systemPromptOverride` (or equivalent) into `runAssistant` so the classical assistant sees the same rule as the heap agent specialist: when the user asks for a self-learning/self-improving/improvement agent, call `ask_user` first with options that map to the four mechanisms (and to list_tools subsets), and do not attach training tools unless the user chose model training.
- Do **not** add this paragraph in the heap path (heap agent specialist already gets it via `agentCreationBlock`).

### 2. Rewrite `AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION` (shared text)

**File:** [packages/ui/app/api/chat/route.ts](packages/ui/app/api/chat/route.ts)

- Replace the current binary (A/B) wording with an explicit list of improvement mechanisms and a clear `ask_user` question.
- **Required behavior (for both classical and heap when they use this text):**
  - When the user asks for a self-learning, self-improving, or improvement agent, the assistant **must** call `ask_user` **before** creating any agent **unless** the user already clearly asked for one specific kind (e.g. "fine-tune a model", "only change workflow edges").
  - The question must name the four mechanisms in user-facing terms: workflow topology, agent improvement (tools and prompts), prompt improvement (apply_agent_prompt_improvement; audited/rollbackable), model training (fine-tune from data/feedback).
  - Offer options that map to existing subsets, e.g. "Prompt and workflow only" → `prompt_and_topology`; "Workflow topology only" → `topology`; "Prompt improvement only" → `prompt`; "Also model training" → no subset (all improvement tools); "Explain the difference" → do not create, explain.
  - Do not attach training tools unless the user chose "Also model training" or explicitly requested training/finetuning.
  - Keep the rule about multi-agent design when tools exceed 10 and about preferring "Prompt and workflow only" when the user has not provided feedback and did not explicitly ask for training.

### 3. Map user choice to `list_tools` subset

- In the same clarification string, document the mapping: "Prompt and workflow only" → `category: "improvement", subset: "prompt_and_topology"`; "Workflow topology only" → `subset: "topology"`; "Prompt improvement only" → `subset: "prompt"`; "Also model training" → `category: "improvement"` with no subset.
- No change to [packages/ui/app/api/_lib/execute-tool.ts](packages/ui/app/api/chat/_lib/execute-tool.ts) or [packages/ui/app/api/_lib/db.ts](packages/ui/app/api/_lib/db.ts) `IMPROVEMENT_SUBSETS` required unless product wants a new combined subset.

### 4. Update tests

**File:** [packages/ui/**tests**/api/_lib/execute-tool.test.ts](packages/ui/__tests__/api/_lib/execute-tool.test.ts)

- Update the test that asserts on `AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION` so it:
  - Still expects `ask_user` and that training tools are not included unless the user chose model training.
  - Expects the clarification to mention workflow topology, agent (or agent improvement), prompt improvement, and model training (or finetuning).
  - Keeps or adjusts assertions on `prompt_and_topology` and `subset` as needed for the new wording.

### 5. Optional: default when context implies “run now” (e.g. saved search)

- The existing override (around line 461–462) that uses the default "Prompt and workflow improvement only" when the plan says create an agent and context has runNow/savedSearchId etc. can remain; ensure it still aligns with the new clarification (default = prompt_and_topology, no training). This applies to the **heap** agent specialist; classical path will get the same clarification text once injected.

## Summary


| Path                             | Currently gets clarification? | Change                                                                                                      |
| -------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Heap** (agent specialist)      | Yes                           | No change to *where* it’s applied; optionally update *wording* (four mechanisms).                           |
| **Classical** (single assistant) | No                            | **Inject** `AGENT_SPECIALIST_IMPROVEMENT_CLARIFICATION` into the system prompt when calling `runAssistant`. |



| User choice              | list_tools                                         | Training tools attached? |
| ------------------------ | -------------------------------------------------- | ------------------------ |
| Prompt and workflow only | category: improvement, subset: prompt_and_topology | No                       |
| Workflow topology only   | category: improvement, subset: topology            | No                       |
| Prompt improvement only  | category: improvement, subset: prompt              | No                       |
| Also model training      | category: improvement, no subset                   | Yes                      |


The assistant (classical or heap) must **ask first** with these options whenever the user asks for a self-improving/self-learning agent without clearly specifying which mechanism(s) they want.