# Agent pattern test examples

Use these example prompts to test that the assistant and workflow engine correctly implement each supported agent pattern. You can paste them into the chat (with an LLM selected) or use the exported arrays in tests (see `packages/ui/__tests__/fixtures/agent-pattern-examples.ts`).

Patterns are defined in `packages/runtime/src/chat/tools/prompt.ts` (BLOCK_AGENTIC_PATTERNS, BLOCK_META_WORKFLOW_PATTERNS).

---

## Intra-agent patterns (single node agent graph)

These patterns apply to **one agent** whose execution follows its internal graph (LLM and tool nodes, edges).

### 1. Prompt chaining

Multiple LLM steps in sequence; each step receives the previous step’s output.

**Example prompts:**

- Create an agent that first summarizes the user’s message in one sentence, then rewrites that summary in a friendly tone. Use two LLM steps chained by edges.
- I need a single agent with two LLM nodes: the first node expands the user input into bullet points, the second node turns those bullets into a short paragraph. Wire them in order.

**What to check:** Agent has ≥2 `llm` nodes and edges between them (e.g. `n1 → n2`). No loop; linear chain.

---

### 2. Autonomous agent

One LLM node with tools; the LLM decides when and how to call tools.

**Example prompts:**

- Create an agent that can fetch a URL and summarize the page. Give it the fetch tool and a clear system prompt so it uses the tool when the user asks for a URL.
- I want one agent that can run a container command (e.g. echo hello). Add the container run tool so the agent can execute the command when I ask.

**What to check:** Agent has one `llm` node, `toolIds` includes the right tool(s), and graph has edges from the LLM node to each tool node.

---

### 3. Sequential LLM → tool → LLM

Fixed order: first LLM, then tool(s), then another LLM. Edges define the sequence; tools get output from the first LLM.

**Example prompts:**

- Create one agent with three steps: (1) LLM decides a search query from the user message, (2) a search/fetch tool runs with that query, (3) a second LLM summarizes the tool result. Edges: llm1 → tool → llm2.
- Single agent: first node is an LLM that extracts a topic from the user input, second node is a tool that fetches data for that topic, third node is an LLM that formats the tool output. Chain them in that order.

**What to check:** Agent graph has at least two `llm` nodes and at least one tool node, with edges forming the sequence llm → tool → llm (or llm → tool1 → tool2 → llm).

---

## Workflow-level patterns (multi-agent workflows)

These patterns use **multiple agents** in a workflow; the workflow engine follows edges between agent nodes.

### 4. Role-based assembly line

Agents as roles (e.g. researcher, writer, reviewer) chained in sequence: A → B → C.

**Example prompts:**

- Create a workflow with three agents: Researcher (gathers facts), Writer (drafts a short article), Reviewer (edits for clarity). Chain them in that order. One workflow, three agents, linear edges.
- I want a research pipeline: one agent that searches and collects info, one that writes a summary, one that checks the summary for accuracy. Put them in a workflow with edges researcher → writer → reviewer.

**What to check:** Workflow has one node per agent, edges form a linear chain (e.g. `n1→n2`, `n2→n3`). No back-edges; `maxRounds` can be 1 for a single pass.

---

### 5. Evaluator–optimizer loop

Two agents in a loop: one generates, one critiques. Use edges A→B and B→A and set `maxRounds` to bound iterations.

**Example prompts:**

- Create two agents that discuss the weather in two cities for 3 rounds each. One agent represents one city, the other the other city. They should use the weather tool and take turns. Run the workflow when done.
- I want a writer and a critic: the writer drafts a paragraph, the critic suggests improvements, then the writer revises. Loop them for 4 rounds (maxRounds 4). Create the workflow and both agents with clear system prompts.

**What to check:** Workflow has two agent nodes with edges `n1→n2` and `n2→n1`; `maxRounds` is set (e.g. 3–5). For “discuss weather”, both agents should have the weather tool and system prompts that say they use it and take turns.

---

### 6. Orchestrator–workers

One coordinator agent that delegates to specialist agents; edges from orchestrator to each worker.

**Example prompts:**

- Create a workflow where an orchestrator agent receives the user request and delegates to two workers: one “search” agent (has fetch/search tool) and one “summarizer” agent (no tools). Orchestrator decides which worker to call. Wire orchestrator to both workers.
- I need one main agent that reads the task and assigns it to either a code agent or a writing agent. Create the orchestrator and the two worker agents, then a workflow with edges from the orchestrator to each worker.

**What to check:** Workflow has at least three agent nodes; one node has edges to the others (orchestrator → worker1, orchestrator → worker2). No requirement for edges back to the orchestrator unless you want a loop.

---

## Meta-patterns (design and iteration)

### 7. Diagnose–fix–rerun

After a run, inspect the trail/output and fix the workflow or agents if the result doesn’t match the goal.

**Example prompts:**

- Run the “two agents discuss weather” workflow. If the trail shows they didn’t actually use the weather tool or talked about something else, fix the agents (add the weather tool or tighten system prompts) and run again.
- I ran workflow X and the output was wrong. Please get the last run, look at the trail, and update the agent prompts or tools so the next run matches what I asked for.

**What to check:** Assistant uses `get_run` / `list_runs` and `get_workflow` / `get_agent` before calling `update_agent` or `update_workflow`, then calls `execute_workflow` again.

---

### 8. Composition over complexity

Prefer several simple, role-focused agents over one big agent; use workflow edges to define the flow.

**Example prompts:**

- Instead of one agent that does research and writing and review, create three separate agents (researcher, writer, reviewer) and chain them in a workflow. Each agent has one clear job.
- Design a workflow with small, focused agents: one that only fetches data, one that only formats it, one that only validates. Connect them with edges so data flows in order.

**What to check:** Result is multiple agents with narrow system prompts and a workflow that composes them via edges rather than a single “do everything” agent.

---

## Quick reference

| Pattern                 | Level     | Key idea                                      | Example ask                          |
|-------------------------|-----------|-----------------------------------------------|--------------------------------------|
| Prompt chaining         | Intra     | Multiple LLM nodes, linear edges              | “Two LLM steps: summarize then rewrite” |
| Autonomous agent        | Intra     | One LLM + tools, LLM decides                  | “Agent that fetches URLs and summarizes” |
| Sequential LLM→tool→LLM | Intra     | Fixed order: llm → tool → llm                 | “LLM suggests query → tool runs → LLM summarizes” |
| Role-based assembly     | Workflow  | Roles chained A→B→C                           | “Researcher → Writer → Reviewer”     |
| Evaluator–optimizer     | Workflow  | Two agents, A↔B, maxRounds                   | “Two agents discuss 3 rounds”        |
| Orchestrator–workers   | Workflow  | One coordinator → multiple workers            | “Orchestrator delegates to search + summarizer” |
| Diagnose–fix–rerun      | Meta      | get_run → update_* → execute again            | “Fix the last run and rerun”         |
| Composition             | Meta      | Many small agents, workflow composes         | “Three focused agents in a pipeline” |
