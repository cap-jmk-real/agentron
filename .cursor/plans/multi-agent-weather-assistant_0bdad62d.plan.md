---
name: multi-agent-weather-assistant
overview: Enable the Agentron chat assistant to autonomously design, create, orchestrate, debug, and refine persistent agents, tools, and workflows (e.g. multi-agent weather conversations) using only generic CRUD tools and its own reasoning, without hard-coded templates.
todos:
  - id: generic-crud-tools
    content: Verify and, if needed, extend generic CRUD tools for agents, tools, workflows, runs, and memory so the assistant can fully create and modify resources via chat.
    status: completed
  - id: autonomous-design-prompting
    content: Strengthen the assistant system prompt and tool docs so it reliably designs agents, tools, and workflows from natural-language requirements, using only generic tools and its own reasoning (no hard-coded patterns).
    status: pending
  - id: persistence-and-reuse
    content: Ensure all resources the assistant creates (tools, agents, workflows) are persisted, surfaced in the UI, and discoverable via list/get tools so the assistant can reuse and refine them in later chats.
    status: pending
  - id: multi-agent-weather-behavior
    content: Define behavioral expectations (in prompt + memory usage) for multi-agent weather conversations, including orchestrator-style behavior (routing between specialists) and rules like “only mention weather changes since last turn”, without encoding fixed templates in code.
    status: pending
  - id: design-iteration-loop
    content: Shape the chat flow so the assistant inspects existing resources and run traces (get_run, list_runs), proposes designs, asks for clarification when under-specified, and then applies and debugs changes (agents, orchestrators, workflows) via create_*/update_* calls in iterative cycles.
    status: pending
  - id: e2e-evaluation
    content: Run and evaluate one or more end-to-end conversations where the assistant autonomously designs weather agents and workflows, saves them, and reuses them in later sessions.
    status: pending
isProject: false
---

# Multi-Agent Weather Conversational Assistant Plan

### Goals

- **Autonomous assistant-designer** that can, from natural-language instructions, design agents, tools, and workflows by calling only generic CRUD tools (list_*, get_*, create_*, update_*, execute_workflow) and its own LLM reasoning — no hard-coded templates in our code.
- **Persistent, reusable resources** so any tools, agents, and workflows the assistant creates are stored, visible in the UI, and discoverable in future chats for reuse or refinement.
- **Rich multi-agent behaviors** (e.g. weather-conversation agents that only mention changes, ask each other follow-up questions, and synthesize context) emerging from prompt design, tool usage, and memory — not from fixed patterns compiled into the runtime.

### High-Level Architecture

- **Generic CRUD tool layer** (already largely present in `[packages/ui/app/api/_lib/db.ts]` and `[packages/ui/app/api/chat/route.ts]`)
  - Tools for listing, getting, creating, updating, deleting:
    - Agents (`list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent`).
    - Workflows (`list_workflows`, `get_workflow`, `create_workflow`, `update_workflow`, `execute_workflow`).
    - Tools (`list_tools`, `get_tool`, `create_tool`, `update_tool`).
    - LLM providers, runs, feedback, assistant memory.
  - These are the only “building blocks” the assistant should need for design; no specialized weather/agent templates in code.
- **Assistant as orchestrator + designer**
  - The chat assistant receives full context (studio resources, preferences, previous chats) and can:
    - Inspect current state via list/get tools.
    - Plan changes using `<reasoning>` and `<todos>` (with our new todoIndex/subStep semantics).
    - Apply those changes via create_*/update_*/execute_workflow calls.
  - All design choices — graph structure, system prompts, tool selection, workflows — come from the assistant’s LLM reasoning guided by its system prompt, not from hard-coded patterns.
- **Persistence & reuse**
  - All resources created via tools are persisted in the DB and surfaced in UI pages (`/agents`, `/tools`, `/workflows`, `/runs`).
  - The assistant is encouraged (in its system prompt) to:
    - Prefer reusing existing tools/agents/workflows where appropriate (e.g. “weather-api-tool-1”), instead of creating duplicates.
    - Use `list_*` and `get_*` to locate resources created in earlier sessions when the user refers to them implicitly (“the weather agents you built last time”).
- **Behavioral expectations for weather multi-agent scenario**
  - We will **describe** desired behaviors in the system prompt and memory usage, but not encode any specific agent graphs or prompts in code:
    - Agents that:
      - Call a weather-API-style tool to get structured weather data.
      - Compare current readings with prior turns and only mention changes when relevant.
      - Read prior messages (including other agents’ questions) and respond with deeper details (e.g. past week/year, street conditions).
    - The assistant is responsible for:
      - Creating or selecting an appropriate weather tool (e.g. a HTTP tool with the right config) using `create_tool` or reusing an existing one.
      - Designing agent prompts and graphs to implement those behaviors.
      - Wiring agents into workflows so they can converse.
- **Memory and “only mention changes”**
  - Use chat assistant memory and/or workflow context objects to:
    - Track the last known weather snapshot per (agent, location, time range).
    - Give the assistant and/or agents enough context (via system prompt and tool messages) to compare “now” vs “last time”.
  - The rule “only mention weather when it changed compared to your previous response” is expressed in prompts and examples; the runtime only stores snapshots and exposes them via tools or context.

### Behavior Patterns (inspired by multi-agent frameworks like OpenCLAW)

- **Tool-first reasoning**: when agents need external data (like weather), they should reason about what to check, call the appropriate tool(s), then synthesize an answer from tool outputs + prior dialogue + their system prompt.
- **Declarative tool contracts**: individual tools (e.g. a weather HTTP tool) should have narrow, well-documented input/output schemas; richer behavior (e.g. comparing changes, answering nuanced questions) stays in LLM prompts, not in code.
- **Multi-agent specialization**:
  - Different agents can adopt different roles (current vs historical, streets vs climate, etc.) purely through how the assistant designs their system prompts and graphs.
  - Our code doesn’t know these roles in advance; the assistant invents and configures them per user request.

### Data Flow Diagram (conceptual)

```mermaid
flowchart LR
  user[User] --> chatAssistant[ChatAssistant]
  chatAssistant --> designTools[ResourceTools(list_*/create_*/update_*)]
  designTools --> agentsDb[AgentsDB]
  designTools --> workflowsDb[WorkflowsDB]

  subgraph designedAgents[DesignedAgents]
    agentA[AgentA_LLM+Tools]
    agentB[AgentB_LLM+Tools]
  end

  workflowsDb --> orchestrator[WorkflowEngine]
  orchestrator --> agentA
  agentA --> state[ConversationState]
  orchestrator --> agentB
  agentB --> state
  state --> orchestrator
  orchestrator --> user
```



### Concrete Implementation Steps (Once You Approve)

- **Step 1: Audit generic tools and persistence paths**  
Confirm that all CRUD-style operations (agents, tools, workflows, runs, memory) are exposed as assistant tools and that resources created via these tools are visible in the UI lists. Add or adjust any missing generic operations, not domain-specific templates.
- **Step 2: Strengthen assistant system prompt and tool docs**  
Update `[packages/runtime/src/chat/tools/prompt.ts]` and related system prompt text so the assistant is explicitly instructed to:
  - Inspect existing resources (`list_*`, `get_*`) before designing new ones.
  - Plan with `<reasoning>` and `<todos>` and then emit `<tool_call>` blocks that actually implement the plan.
  - Create agents, tools, and workflows directly from user requirements, and refine them iteratively via `update_*`, without relying on hard-coded patterns.
- **Step 3: Encode behavioral expectations (not templates) for weather conversations**  
In the prompt text and examples, describe the desired multi-agent weather behavior (talk about weather, ask follow-ups, only mention changes, etc.), but leave concrete agent definitions to the assistant’s tool calls.
- **Step 4: Encourage reuse and refinement in the assistant flow**  
Make sure the prompt nudges the assistant to:
  - Reuse existing tools/agents/workflows when they match the user’s request.
  - Use `get_*` and `update_*` to refine prior designs when the user asks to “tune” or “extend” behavior.
- **Step 5: Add or clarify memory usage for “only mention changes”**  
Decide whether to use chat memory tables, workflow context, or both to expose prior weather snapshots and agent outputs to the assistant, and describe that clearly in the system prompt so the model can compare past vs current data.
- **Step 6: Run end-to-end evaluations**  
Use the chat assistant itself to:
  - Design a pair (or more) of weather-conversation agents and a workflow connecting them.
  - Verify that tools, agents, and workflows are persisted and appear in UI lists.
  - Start new chats that ask to “reuse the weather agents you created earlier” and confirm the assistant finds and reuses them correctly.

