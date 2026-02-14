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
    description: "Run a one-off command in a Podman/Docker container and return the output. Use this when the user wants to run a container just to execute a single command (e.g. 'run a podman container to echo hello world', 'run docker to print something'). Creates a container from the image, runs the command, then removes the container. For a persistent sandbox where you run multiple commands, use create_sandbox then execute_code instead.",
    parameters: {
      type: "object",
      properties: {
        image: { type: "string", description: "Container image (e.g. alpine, busybox, ubuntu:22.04)" },
        command: { type: "string", description: "Shell command to run inside the container (e.g. echo hello world)" },
      },
      required: ["image", "command"],
    },
  },
  {
    name: "list_sandboxes",
    description: "List all Podman/Docker sandboxes (name, id, image, status). Use when the user asks what sandboxes exist or before reusing an existing sandbox with execute_code.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_sandbox",
    description: "Create a new Podman/Docker sandbox for code execution (persistent container). Use when the user wants a long-lived environment for multiple commands. For a single command, use run_container_command instead.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        image: { type: "string", description: "Container image (e.g. node:22-slim, python:3.12-slim)" },
      },
      required: ["image"],
    },
  },
  {
    name: "execute_code",
    description: "Execute a command in an existing sandbox (use sandboxId from create_sandbox or list_sandboxes)",
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
    name: "answer_question",
    description: "Answer a general knowledge question, coding question, or any conversational query the user asks — just like ChatGPT or Claude would. Use this tool whenever the user is NOT asking you to create, edit, list, or manage studio resources, but instead wants information, explanations, advice, brainstorming, writing help, or any other general-purpose response.",
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
    description: "Explain what AgentOS Studio is, what features it has, and how to use it. Use this when the user asks about the software itself — its capabilities, how agents/workflows/tools/sandboxes work, or needs onboarding help.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The specific topic or feature to explain (e.g. 'agents', 'workflows', 'sandboxes', 'general')" },
      },
      required: ["topic"],
    },
  },
];
