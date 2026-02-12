# Workflow memory & context delivery to agents and tools

## Context hierarchy

**External context** = context from the level **above** the agent in the hierarchy (i.e. **workflow**). From the agent's point of view, "external" is workflow-level: shared memory, summary, recent turns, round, etc. The agent does not own this; the workflow does. The agent **receives** (and optionally contributes to) external context via a **dedicated tool** that the workflow runner provides — e.g. `get_workflow_context` / `read_external_context` — rather than only via prompt injection. So external context is set and read at the workflow level and reflected to the agent through that tool.

---

## Problem

The agent in a workflow is an **LLM call (with optional tools)**. For conversation and tool use to work:

1. **The LLM** must receive: workflow memory (shared), optional RAG, tool instructions, and the partner's message. Right now it only receives the raw previous node output as the single “user” message.
2. **Tools** invoked by that LLM may need context (e.g. conversation summary) to run correctly. Right now they only receive the arguments the LLM sent; no shared context is passed.

So we must explicitly plan **where each piece of context is built** and **where it is injected** so both the agent's LLM and any tool it calls receive what they need.

---

## Data flow (current vs desired)

### Current

- **run-workflow** `agentHandler`: builds `input = sharedContext.get(__output_<fromId>)` (previous node output only). Passes `input` and `context` (with `sharedContext` snapshot, `callLLM`, `callTool`, `availableTools`) to the executor.
- **NodeAgentExecutor**: for an `llm` node, sends to the LLM: `systemPrompt` (from graph node) + **one user message = stringify(input)**. Tools are passed as the `tools` array (for function calling). No workflow memory, no RAG, no tool-instruction text.
- **Tool invocation**: `context.callTool(toolId, args)` → `executeStudioTool(toolId, args)`. The tool receives only `args` from the LLM; no conversation or workflow context.

### Desired

- **Workflow memory** (summary + recent turns) and **partner message** are part of the **user-facing content** the LLM sees every turn.
- **RAG** (per-agent) and **tool instructions** (per-tool) are also part of that same prompt, in a fixed order.
- When a **tool** is executed, it can optionally receive a **context payload** (e.g. current workflow memory summary or last N turns) so tools that need context can use it without the LLM having to paste it into every tool call.

---

## 1. Delivering context to the agent

**External (workflow) context via a dedicated tool**  
The workflow runner provides a **dedicated tool** (e.g. `get_workflow_context` or `read_external_context`) that returns the current workflow-level context: summary, recent turns, round, etc. The agent can **call** this tool when it needs external context instead of (or in addition to) receiving it in the prompt. So "external context" is the hierarchy level above the agent (workflow) and is **set** / exposed via this tool. The workflow owns the data; the tool is the interface the agent uses to read it (and optionally to append or update, if we support that).

**Prompt injection (same data, for convenience)**  
The agent's single LLM request can also include that same workflow context in the user message each turn so the model sees it without having to call the tool first. Both the dedicated tool and the injected block reflect the same external (workflow) context.

## 1b. Prompt content (injection path)

The agent's single LLM request must see one coherent “user” content that includes, in order:

1. Workflow memory (summary + recent turns)
2. RAG block (if agent has RAG)
3. Tool instructions (if agent has tools with system prompts)
4. Partner's last message (or “User/partner just said: …”)

**Where to build vs where to inject**

- **Workflow layer (run-workflow)**  
  - Owns **workflow memory**: maintains `__recent_turns` and `__summary` in `sharedContext`, and builds the **workflow memory block** string (summary + recent turns + “Partner just said: …”).  
  - Can either:  
    - Pass that block as the only `input` to the executor (so the executor just passes it through as the user message), or  
    - Put the block in `sharedContext` and pass a small structured `input` (e.g. `{ partnerMessage, workflowMemoryRef: true }`) and let the executor read from `sharedContext` and assemble the final user message.  
  - Recommendation: **workflow builds the full “base user content”** = workflow memory block (including “Partner just said: …”) and passes it as `input`. That way the executor does not need to know workflow memory format; it only adds agent-specific pieces (RAG, tool instructions).

- **Executor layer (NodeAgentExecutor)**  
  - Receives `input` (string = workflow memory + partner message when run from a workflow).  
  - **If** agent has RAG: run retrieval (query = e.g. partner message + last summary line), get chunks, build RAG block.  
  - **If** agent has tools: load tool definitions (including optional `systemPrompt` / `instructions`), build tool-instructions block.  
  - Build **final user message** = `[RAG block if any] + [Tool instructions block if any] + input`.  
  - Send to LLM: `systemPrompt` (from graph node) + that single user message + `tools` array.  
  - So the **executor** is responsible for prepending RAG and tool instructions so the model sees them before the conversation + partner message. The executor needs:  
  - Access to RAG (e.g. `context.retrieveRag?.(query, maxTokens)` or precomputed `context.ragBlock?`).  
  - Tool metadata including `systemPrompt` (e.g. `context.availableToolsWithInstructions` or load tools by id and get instructions).

- **Who runs RAG**  
  - Option A: Workflow runs RAG before calling the agent (workflow has agent's `ragConfig`), builds `ragBlock`, passes it in `context.ragBlock`. Executor only injects it.  
  - Option B: Executor runs RAG (executor gets `context.retrieveRag` and agent's `ragConfig` from definition).  
  - Recommendation: **workflow runs RAG** so workflow owns all “external” context (workflow memory + RAG); executor only assembles prompt from `input` + optional `context.ragBlock` + optional tool instructions. That keeps the executor simpler and avoids passing agent definition into executor for RAG config.

**Concrete flow**

1. **run-workflow** (before calling the executor for a node):  
   - Build workflow memory block from `__recent_turns` and `__summary`; append “Partner just said: \<partner output\>”. That is `input` (string).  
   - If agent has `ragConfig`: call retrieve, build `ragBlock` (capped).  
   - Load tool instructions for `toolIds` (from DB), build `toolInstructionsBlock` (capped).  
   - Pass to executor: `input` (string) and extend `context` with `ragBlock?`, `toolInstructionsBlock?` (or pass them inside a single `context.promptBlocks = { rag?, toolInstructions? }`).  
2. **NodeAgentExecutor** (llm node):  
   - `userContent = (context.ragBlock ?? "") + (context.toolInstructionsBlock ?? "") + input`.  
   - Call LLM with system + `userContent` + tools.  
   - So the **agent's LLM always receives** workflow memory + partner message (in `input`) and, when present, RAG and tool instructions.

This way we have explicitly considered that **the agent's LLM is the one that needs the context**, and we've defined exactly where each block is built and where it's injected so it reaches that single LLM call.

---

## 2. Delivering context to tools

When the LLM calls a tool (e.g. `search_docs`, `run_code`), the **tool implementation** may need the current conversation or workflow state to behave correctly. Today the tool only receives `(toolId, args)` where `args` is what the LLM put in the tool call.

**Approach: inject a reserved context payload when calling the tool**

- When the executor (or the workflow's `callTool` wrapper) invokes `context.callTool(toolId, args)`, it can pass an **override** or an extended **context** that the runner (run-workflow) uses when calling `executeStudioTool`.  
- Convention:  
  - Run-workflow's `callTool` wrapper receives not only `(toolId, input)` but also access to current `sharedContext`.  
  - It builds a small **tool context** object, e.g. `{ workflowSummary?: string, recentTurns?: string[], round?: number }` from `sharedContext`, and passes it to `executeStudioTool(toolId, input, { toolContext })`.  
  - `executeStudioTool` (or the tool adapter) merges `toolContext` into the payload the tool actually sees (e.g. under a reserved key `__context` or `_workflowContext`), or passes it as a second argument if the tool signature supports it.  
- Standard tools (fetchUrl, runCode, etc.) can ignore `__context`; custom or HTTP tools that “need the context” can read it and use it (e.g. to improve a search query or to scope code execution).

Run npm run build:docs
  npm run build:docs
  shell: /usr/bin/bash -e {0}
  env:
    BASE_URL: /agentron/
    URL: https://cap-jmk-real.github.io/agentron/
npm warn config optional Use `--omit=optional` to exclude optional dependencies, or
npm warn config `--include=optional` to include them.
npm warn config
npm warn config       Default value does install optional deps unless otherwise omitted.

> agentron-studio@0.1.0 build:docs
> npm --workspace apps/docs run build

npm warn config optional Use `--omit=optional` to exclude optional dependencies, or
npm warn config `--include=optional` to include them.
npm warn config
npm warn config       Default value does install optional deps unless otherwise omitted.

> @agentron-studio/docs@0.1.0 build
> docusaurus build


Error:  Error: The url is not supposed to contain a sub-path like "/agentron/". Please use the baseUrl field for sub-paths.

    at validateConfig (/home/runner/work/agentron/agentron/node_modules/@docusaurus/core/lib/server/configValidation.js:397:15)
    at loadSiteConfig (/home/runner/work/agentron/agentron/node_modules/@docusaurus/core/lib/server/config.js:40:62)
    at async Promise.all (index 1)
    at async loadContext (/home/runner/work/agentron/agentron/node_modules/@docusaurus/core/lib/server/site.js:39:97)
    at async getLocalesToBuild (/home/runner/work/agentron/agentron/node_modules/@docusaurus/core/lib/commands/build/build.js:55:21)
    at async Command.build (/home/runner/work/agentron/agentron/node_modules/@docusaurus/core/lib/commands/build/build.js:30:21)
    at async Promise.all (index 0)
    at async runCLI (/home/runner/work/agentron/agentron/node_modules/@docusaurus/core/lib/commands/cli.js:56:5)
    at async file:///home/runner/work/agentron/agentron/node_modules/@docusaurus/core/bin/docusaurus.mjs:44:3
[INFO] Docusaurus version: 3.9.2
Node version: v20.20.0
npm error Lifecycle script `build` failed with error:
npm error code 1
npm error path /home/runner/work/agentron/agentron/apps/docs
npm error workspace @agentron-studio/docs@0.1.0
npm error location /home/runner/work/agentron/agentron/apps/docs
npm error command failed
npm error command sh -c docusaurus build
Error: Process completed with exit code 1.
So:

- **Workflow/runner** owns building the tool-context payload from `sharedContext` and passing it into every tool call during that run.  
- **Native tools** get context in-process (reserved key or second arg). **External tools (HTTP, MCP)** get it only if we include it in the request (body/headers or arguments) so the workflow context can be reflected by external services that choose to use it.

---

## 3. Summary

| Concern | Where it's built | Where it's injected | Reaches |
|--------|-------------------|--------------------|--------|
| **External (workflow) context** | run-workflow (`sharedContext`) | **Dedicated tool** (e.g. `get_workflow_context`) provided by workflow to agent | Agent when it calls the tool (hierarchy: workflow = external, above agent) |
| Workflow memory + partner message | run-workflow (from `sharedContext`) | As `input` (string) to executor | Agent's LLM (single user message) |
| RAG block | run-workflow (if agent has RAG) | Via `context.ragBlock` (or similar) | Agent's LLM (prepended to user message) |
| Tool instructions | run-workflow (load tools, build block) | Via `context.toolInstructionsBlock` | Agent's LLM (prepended to user message) |
| Tool execution context | run-workflow (from `sharedContext`) | In `callTool` → `executeStudioTool(..., { toolContext })` | Tool implementation (reserved key or second arg) |

With this, both the **agent's LLM** and **tools that need context** receive the right data without relying on the model to copy context into every tool call.
