import type { AssistantToolDef } from "./types";

export const MISC_TOOLS: AssistantToolDef[] = [
  {
    name: "create_custom_function",
    description: "Create a custom code function that can be used as a tool",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        language: { type: "string", enum: ["javascript", "python", "typescript"] },
        source: { type: "string", description: "The source code" },
        description: { type: "string" },
      },
      required: ["name", "language", "source"],
    },
  },
  {
    name: "run_container_command",
    description:
      "Run a one-off command in a Podman/Docker container and return the output. Use this when the user wants to run a container just to execute a single command (e.g. 'run a podman container to echo hello world', 'run docker to print something'). Creates a container from the image, runs the command, then removes the container. For a persistent sandbox where you run multiple commands, use create_sandbox then execute_code instead.",
    parameters: {
      type: "object",
      properties: {
        image: {
          type: "string",
          description: "Container image (e.g. alpine, busybox, ubuntu:22.04)",
        },
        command: {
          type: "string",
          description: "Shell command to run inside the container (e.g. echo hello world)",
        },
      },
      required: ["image", "command"],
    },
  },
  {
    name: "list_sandboxes",
    description:
      "List all Podman/Docker sandboxes (name, id, image, status). Use when the user asks what sandboxes exist or before reusing an existing sandbox with execute_code.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_sandbox",
    description:
      "Create a new Podman/Docker sandbox for code execution (persistent container). Use when the user wants a long-lived environment for multiple commands. For a single command, use run_container_command instead.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        image: {
          type: "string",
          description: "Container image (e.g. node:22-slim, python:3.12-slim)",
        },
      },
      required: ["image"],
    },
  },
  {
    name: "execute_code",
    description:
      "Execute a command in an existing sandbox (use sandboxId from create_sandbox or list_sandboxes). Prefer short commands; for long sequences (e.g. clone then install then build) use multiple execute_code calls so each stays under ~1500 characters.",
    parameters: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        command: { type: "string" },
      },
      required: ["sandboxId", "command"],
    },
  },
  {
    name: "bind_sandbox_port",
    description:
      "Expose a container port from a sandbox to the host. Allocates a free host port and returns it (and optional WebSocket URL). Use when you need to reach a service inside the sandbox (e.g. OpenClaw gateway on port 18789). Call once per sandbox per container port; each sandbox gets a distinct host port.",
    parameters: {
      type: "object",
      properties: {
        sandboxId: {
          type: "string",
          description: "Sandbox id from create_sandbox or list_sandboxes",
        },
        containerPort: {
          type: "number",
          description: "Port inside the container to expose (e.g. 18789 for OpenClaw gateway)",
        },
        host: {
          type: "string",
          description: "Host to bind to (default 127.0.0.1)",
        },
      },
      required: ["sandboxId", "containerPort"],
    },
  },
  {
    name: "list_files",
    description: "List all uploaded context files",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_runs",
    description: "List recent execution runs",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "web_search",
    description:
      "Search the web for current information, recent events, or facts. Use this when the user asks for up-to-date info, 'look it up', news, or anything that may have changed since your knowledge cutoff. Returns titles, URLs, and snippets you can cite or summarize.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max number of results (default 8, max 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch the full content of a specific URL (e.g. a documentation page, article, or link). Use this when the user asks you to visit a page, read documentation, open a link, or when you need the full content of a URL (e.g. from web_search results) to answer accurately. For research: use web_search first, then optionally fetch_url for the most relevant URLs to get full text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (e.g. https://example.com/docs)" },
      },
      required: ["url"],
    },
  },
  {
    name: "answer_question",
    description:
      "Answer a general knowledge question, coding question, or any conversational query the user asks — just like ChatGPT or Claude would. Use this tool whenever the user is NOT asking you to create, edit, list, or manage studio resources, but instead wants information, explanations, advice, brainstorming, writing help, or any other general-purpose response.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The user's question or request to answer" },
      },
      required: ["question"],
    },
  },
  {
    name: "explain_software",
    description:
      "Explain what AgentOS Studio is, what features it has, and how to use it. Use this when the user asks about the software itself — its capabilities, how agents/workflows/tools/sandboxes work, or needs onboarding help.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "The specific topic or feature to explain (e.g. 'agents', 'workflows', 'sandboxes', 'general')",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "run_shell_command",
    description:
      "Run a shell command on the host machine when you need to accomplish something via the CLI. The system context tells you the OS (Windows/macOS/Linux) — use platform-appropriate commands: on Windows use PowerShell (where.exe to find executables, e.g. where.exe podman); on Unix use sh style (which, ls). The command must be approved by the user unless it is on their allowlist. Returns stdout/stderr or needsApproval if approval is required.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run (e.g. docker ps, podman --version)",
        },
      },
      required: ["command"],
    },
  },
];
