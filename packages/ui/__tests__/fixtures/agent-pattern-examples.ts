/**
 * Example user prompts to test each agent pattern.
 * Use in chat E2E tests or manual testing. See docs/agent-pattern-test-examples.md for full descriptions and assertions.
 */

export type AgentPatternId =
  | "prompt-chaining"
  | "autonomous-agent"
  | "sequential-llm-tool-llm"
  | "role-based-assembly-line"
  | "evaluator-optimizer"
  | "orchestrator-workers"
  | "diagnose-fix-rerun"
  | "composition-over-complexity";

export interface PatternExample {
  patternId: AgentPatternId;
  /** Short label for the pattern (matches prompt.ts terminology) */
  label: string;
  /** User prompt(s) that should trigger this pattern */
  prompts: string[];
  /** Level: intra-agent (node graph) vs workflow (multi-agent) vs meta (design/iteration) */
  level: "intra" | "workflow" | "meta";
}

export const AGENT_PATTERN_EXAMPLES: PatternExample[] = [
  {
    patternId: "prompt-chaining",
    label: "Prompt chaining",
    level: "intra",
    prompts: [
      "Create an agent that first summarizes the user's message in one sentence, then rewrites that summary in a friendly tone. Use two LLM steps chained by edges.",
      "I need a single agent with two LLM nodes: the first node expands the user input into bullet points, the second node turns those bullets into a short paragraph. Wire them in order.",
    ],
  },
  {
    patternId: "autonomous-agent",
    label: "Autonomous agent",
    level: "intra",
    prompts: [
      "Create an agent that can fetch a URL and summarize the page. Give it the fetch tool and a clear system prompt so it uses the tool when the user asks for a URL.",
      "I want one agent that can run a container command (e.g. echo hello). Add the container run tool so the agent can execute the command when I ask.",
    ],
  },
  {
    patternId: "sequential-llm-tool-llm",
    label: "Sequential LLM → tool → LLM",
    level: "intra",
    prompts: [
      "Create one agent with three steps: (1) LLM decides a search query from the user message, (2) a search/fetch tool runs with that query, (3) a second LLM summarizes the tool result. Edges: llm1 → tool → llm2.",
      "Single agent: first node is an LLM that extracts a topic from the user input, second node is a tool that fetches data for that topic, third node is an LLM that formats the tool output. Chain them in that order.",
    ],
  },
  {
    patternId: "role-based-assembly-line",
    label: "Role-based assembly line",
    level: "workflow",
    prompts: [
      "Create a workflow with three agents: Researcher (gathers facts), Writer (drafts a short article), Reviewer (edits for clarity). Chain them in that order. One workflow, three agents, linear edges.",
      "I want a research pipeline: one agent that searches and collects info, one that writes a summary, one that checks the summary for accuracy. Put them in a workflow with edges researcher → writer → reviewer.",
    ],
  },
  {
    patternId: "evaluator-optimizer",
    label: "Evaluator–optimizer loop",
    level: "workflow",
    prompts: [
      "Create two agents that discuss the weather in two cities for 3 rounds each. One agent represents one city, the other the other city. They should use the weather tool and take turns. Run the workflow when done.",
      "I want a writer and a critic: the writer drafts a paragraph, the critic suggests improvements, then the writer revises. Loop them for 4 rounds (maxRounds 4). Create the workflow and both agents with clear system prompts.",
    ],
  },
  {
    patternId: "orchestrator-workers",
    label: "Orchestrator–workers",
    level: "workflow",
    prompts: [
      "Create a workflow where an orchestrator agent receives the user request and delegates to two workers: one \"search\" agent (has fetch/search tool) and one \"summarizer\" agent (no tools). Orchestrator decides which worker to call. Wire orchestrator to both workers.",
      "I need one main agent that reads the task and assigns it to either a code agent or a writing agent. Create the orchestrator and the two worker agents, then a workflow with edges from the orchestrator to each worker.",
    ],
  },
  {
    patternId: "diagnose-fix-rerun",
    label: "Diagnose–fix–rerun",
    level: "meta",
    prompts: [
      "Run the \"two agents discuss weather\" workflow. If the trail shows they didn't actually use the weather tool or talked about something else, fix the agents (add the weather tool or tighten system prompts) and run again.",
      "I ran workflow X and the output was wrong. Please get the last run, look at the trail, and update the agent prompts or tools so the next run matches what I asked for.",
    ],
  },
  {
    patternId: "composition-over-complexity",
    label: "Composition over complexity",
    level: "meta",
    prompts: [
      "Instead of one agent that does research and writing and review, create three separate agents (researcher, writer, reviewer) and chain them in a workflow. Each agent has one clear job.",
      "Design a workflow with small, focused agents: one that only fetches data, one that only formats it, one that only validates. Connect them with edges so data flows in order.",
    ],
  },
];

/** All prompts flattened with their pattern id (for tests that iterate over every example). */
export function getAllPrompts(): { patternId: AgentPatternId; prompt: string }[] {
  const out: { patternId: AgentPatternId; prompt: string }[] = [];
  for (const ex of AGENT_PATTERN_EXAMPLES) {
    for (const prompt of ex.prompts) {
      out.push({ patternId: ex.patternId, prompt });
    }
  }
  return out;
}

/** Get examples for a given level (intra, workflow, or meta). */
export function getExamplesByLevel(level: PatternExample["level"]): PatternExample[] {
  return AGENT_PATTERN_EXAMPLES.filter((e) => e.level === level);
}
