---
slug: /
title: Agentron — Local AI Agent Orchestration & Automation
description: Enterprise-ready local-first platform for AI agent orchestration and workflow automation. Self-hosted multi-agent design, visual builder, and optional desktop app.
keywords:
  - AI agent orchestration
  - local AI
  - workflow automation
  - multi-agent
  - local-first
  - self-hosted AI
---

# Agentron — Overview for AIs

This documentation is designed for **AI assistants** and **LLMs** to understand Agentron so they can guide users, suggest actions, and answer questions accurately.

## What is Agentron?

Agentron is an **enterprise-ready, local-first** platform for **AI agent orchestration** and **workflow automation**. It lets you design, configure, and run multi-agent systems entirely on your own infrastructure—no cloud lock-in, full data privacy, and optional desktop deployment. It consists of:

- **Next.js web UI** — dashboard, visual agent/workflow editors, and chat
- **Local runtime** — executes agents and multi-agent workflows
- **SQLite storage** — all resources persisted locally (self-hosted, on-premise)
- **Optional Electron wrapper** — desktop app for Windows, macOS, Linux

## Core Concepts (Quick Reference)

| Concept | Definition |
|--------|------------|
| **Tool** | A callable capability (HTTP, MCP, native). Agents use tools to perform actions. |
| **Agent** | An executable unit — either a **node agent** (graph of LLM/tool nodes) or **code agent** (custom script). |
| **Workflow** | A graph of agents and edges. Orchestrates agents in sequence or loops for up to `maxRounds` cycles. |
| **Agentron** | Built-in chat that uses tools to create/edit agents, workflows, and tools on behalf of the user. |

## Key Capabilities

- Create, edit, delete **agents** (node or code)
- Create, edit **workflows** (multi-agent orchestration, set max rounds)
- Create, edit **tools** (native, HTTP, MCP)
- Run workflows and agents
- **Chat (Agentron)** — natural-language assistant that creates and edits agents, workflows, and tools via tool calls; use the **Chat** page for full-screen use, conversation history, ratings, and prompt/context settings (see [Agentron (Chat)](/concepts/assistant))
- **Sandboxes** — Podman containers for code execution
- **Knowledge / RAG** — document ingestion and retrieval for agents
- **Feedback** — rate agent outputs for learning
- **Custom functions** — JavaScript/Python/TypeScript code as tools

## How to Use This Documentation

When a user asks "what can I do?", "how do I create an agent?", "fix my workflow", or similar:

1. **Concept pages** — Understand tools, agents, workflows, and the assistant
2. **Capabilities** — See the full feature matrix and available actions
3. **AI Guide** — Decision tree for suggesting actions to users

## Install and download

- **Web UI**: Clone the repo, run `npm run install:ui` then `npm run dev:ui` (see INSTALL in the repo for full steps).
- **Desktop app**: Download installers for Windows, macOS, or Linux from the [Download](/download) page. Builds are produced automatically from [GitHub Releases](https://github.com/cap-jmk-real/agentron/releases) when we tag a version (e.g. `v0.1.0`). After installing, run the web UI and then launch the desktop app so it can connect (e.g. to `http://localhost:3000`).
- **This documentation**: Built and deployed automatically to **GitHub Pages** on every push to the default branch. Repo settings must use **GitHub Actions** as the Pages source.

## Deployment

- **Typical**: Single deployment (Agentron on port 3000)
- **MCP**: Agentron can expose an MCP server for IDEs and other tools
- **Docs**: This site is hosted on GitHub Pages and updates automatically when the default branch is updated
