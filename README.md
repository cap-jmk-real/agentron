# Agentron — Enterprise-Ready Local AI Agent Orchestration & Automation

[![CI](https://github.com/agentron-studio/agentron/actions/workflows/ci.yml/badge.svg)](https://github.com/agentron-studio/agentron/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-50%25%2B-brightgreen)](packages/ui/__tests__/README.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Local-first](https://img.shields.io/badge/local--first-sqlite%20%2B%20Electron-8B5CF6)](INSTALL.md)

**Agentron** is an **enterprise-ready, local-first** platform for **AI agent orchestration** and **workflow automation**. Design and run multi-agent systems entirely on your own infrastructure—no cloud lock-in, full data privacy, and optional desktop deployment.

- **Local-first & self-hosted** — SQLite storage, optional Electron desktop app; run on-premise or air-gapped.
- **Visual agent builder** — Node-based graphs (LLM, tools, decision nodes) plus code agents (JavaScript/Python/TypeScript) in sandboxes.
- **Multi-agent workflows** — Orchestrate agents in graphs with configurable rounds; built-in chat assistant that creates and edits agents, workflows, and tools via natural language.
- **Tools & integrations** — Native, HTTP, and MCP tools; RAG/knowledge; Podman sandboxes; OpenAI, Anthropic, Ollama, and remote LLM support.

Ideal for teams that need **local AI automation**, **privacy-first agent orchestration**, and **multi-agent workflow** control without depending on cloud-only platforms.

## How to install Agentron

**Prerequisites:** Node.js 18+ and npm.

1. Clone the repo and enter the project: `git clone <repo-url> && cd agentron`
2. Install dependencies: `npm run install:ui` (UI only) or `npm install` (full, including desktop)
3. Run the app: `npm run dev:ui` then open http://localhost:3000

Full step-by-step instructions, troubleshooting, and desktop build details: **[INSTALL.md](INSTALL.md)**.

## Structure

- `packages/ui`: Next.js UI
- `packages/runtime`: Local runtime (agent execution)
- `packages/core`: Shared types and utilities
- `apps/desktop`: Electron wrapper
- `installers`: Local LLM installer scripts

## Dependency isolation (UI vs Desktop)

To avoid pulling in the Electron packaging toolchain during UI work:

```bash
npm run install:ui
npm run dev:ui
```

When you need desktop packaging dependencies:

```bash
npm run install:desktop
```

**Optional dependencies:** We omit optional deps by default (see `.npmrc`). The desktop app needs optional deps (e.g. `sharp`) for icon export. CI and local desktop builds use `npm install --include=optional sharp --workspace apps/desktop` so that workspace gets them; no need to change the default for the rest of the repo.
