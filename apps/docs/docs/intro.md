---
slug: /
---

# Agentron — Overview for AIs

This documentation is designed for **AI assistants** and **LLMs** to understand Agentron so they can guide users, suggest actions, and answer questions accurately.

## What is Agentron?

Agentron is a **local-first platform** for designing, configuring, and running AI agents. It consists of:

- **Next.js web UI** — dashboard, editors, and chat
- **Local runtime** — executes agents and workflows
- **SQLite storage** — all resources are persisted locally
- **Optional Electron wrapper** — desktop app

## Core Concepts (Quick Reference)

| Concept | Definition |
|--------|------------|
| **Tool** | A callable capability (HTTP, MCP, native). Agents use tools to perform actions. |
| **Agent** | An executable unit — either a **node agent** (graph of LLM/tool nodes) or **code agent** (custom script). |
| **Workflow** | A graph of agents and edges. Executes agents in sequence or loops for up to `maxRounds` cycles. |
| **Agentron** | Built-in chat that uses tools to create/edit agents, workflows, and tools on behalf of the user. |

## Key Capabilities

- Create, edit, delete **agents** (node or code)
- Create, edit **workflows** (connect agents, set max rounds)
- Create, edit **tools** (native, HTTP, MCP)
- Run workflows and agents
- **Agentron** — natural-language interface that executes tool calls
- **Sandboxes** — Podman containers for code execution
- **Knowledge / RAG** — document ingestion and retrieval for agents
- **Feedback** — rate agent outputs for learning
- **Custom functions** — JavaScript/Python/TypeScript code as tools

## How to Use This Documentation

When a user asks "what can I do?", "how do I create an agent?", "fix my workflow", or similar:

1. **Concept pages** — Understand tools, agents, workflows, and the assistant
2. **Capabilities** — See the full feature matrix and available actions
3. **AI Guide** — Decision tree for suggesting actions to users

## Deployment

- **Typical**: Single deployment (Agentron on port 3000)
- **MCP**: Agentron can expose an MCP server for IDEs and other tools
- **Hosting**: Static docs (this site) can be deployed to Vercel, Netlify, GitHub Pages, or any static host
