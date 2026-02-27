# Agentron: Cutting-Edge Local AI Agent Orchestration & Automation

[![CI](https://img.shields.io/github/actions/workflow/status/cap-jmk-real/agentron/ci.yml?style=flat-square&label=CI)](https://github.com/cap-jmk-real/agentron/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cap-jmk-real/agentron/main/badges/coverage.json&style=flat-square)](https://codecov.io/gh/cap-jmk-real/agentron)
[![lines of code](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cap-jmk-real/agentron/main/badges/loc.json&style=flat-square)](https://github.com/cap-jmk-real/agentron)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Local-first](https://img.shields.io/badge/local--first-SQLite%20%2B%20Electron-8B5CF6?style=flat-square)](INSTALL.md)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-0ea5e9?style=flat-square&logo=readthedocs&logoColor=white)](https://docs.agentron.rocks/)

Agentron is a local-first, open-source platform for AI agent orchestration and workflow automation. With **heap mode** (**Level 4** — recursive/self-building), the planner assembles a DAG of agents per request and can create new tools and agents on the fly; each turn uses a model-chosen specialist graph. Without heap, chat uses **Level 1** (ReAct + tools). Workflows use **Level 2** (static multi-agent). You run everything on your own infrastructure: no cloud lock-in, full data privacy, optional desktop app.

<details>
<summary><strong>Table of contents</strong></summary>

- [About](#about)
- [Features](#features)
- [Agent architecture and orchestration](#agent-architecture-and-orchestration)
- [Event-driven architecture](#event-driven-architecture)
- [Getting started](#getting-started)
- [Installation](#installation)
- [Usage](#usage)
- [Project structure](#project-structure)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

</details>

## About

Agentron lets you design, run, and manage AI agents and multi-agent workflows locally. Its differentiator is **heap mode** (**Level 4**): the planner chooses which specialists (e.g. **workflow**, **agent**) and in what order or parallelism per request and can create new tools and agents on the fly; the runtime builds and runs that DAG. When heap is off, chat uses **Level 1** (ReAct + tools). Workflows use **Level 2** (static multi-agent). Ideal for teams that want cutting-edge agent orchestration with production safety (cost control, loop limits, provider-agnostic LLMs) and privacy-first automation without cloud-only platforms.

## Features

- **Heap (Level 4 — recursive/self-building).** Planner selects specialists and order per request; runtime builds and runs the DAG; can create new tools and agents on the fly. Fallback: **Level 1** (one ReAct-style agent) when heap is off; max steps and loop limits throughout.
- **Local-first and self-hosted.** SQLite storage, optional Electron desktop app; run on-premise or air-gapped.
- **Visual agent builder.** Node-based graphs (LLM, tools, decision nodes) and code agents (JavaScript, Python, TypeScript) in sandboxes.
- **Multi-agent workflows (Level 2).** Human-designed graphs and configurable rounds; the chat assistant creates and edits agents, workflows, and tools via natural language.
- **Tools and integrations.** Native, HTTP, and MCP tools; RAG and knowledge connectors (Notion, Google Drive, Dropbox, OneDrive, Confluence, GitBook, local folders); Podman sandboxes; OpenAI, Anthropic, Ollama, and remote LLM support; OpenClaw gateway integration.

## Agent architecture and orchestration

**ReAct** (Reasoning + Acting) is the pattern used by most production assistants: one LLM, one context, a fixed set of tools; the model loops over thought, choose tool, act, observe. Used by ChatGPT (function calling), Claude (tools), and the OpenAI Assistants API: single orchestrator, fixed tool set, dynamic tool selection only.

**Why Agentron is cutting edge:** With heap on, Agentron runs at **Level 4** (recursive/self-building): the planner assembles a DAG of specialists per request and can create new tools and agents on the fly. Specialists are real roles in the app (e.g. workflow, agent); the model picks which run and in what order each turn. Without heap, chat uses **Level 1** (ReAct + tools). Workflows use **Level 2** (static topology, human-designed graphs). Max steps, loop detection, and tool-call budgets are enforced. For the full taxonomy (Levels 1–4), see [Agent architectures (comparison)](https://docs.agentron.rocks/concepts/agent-architectures) in the docs.

## Event-driven architecture

Agentron uses **event-driven** patterns under the hood for execution and delivery: **workflow runs** are driven by a DB-backed **event queue** (RunStarted, NodeRequested, NodeCompleted, UserResponded) with persisted run state for pause/resume and user-in-the-loop; **chat turns** can be consumed via a **pub/sub event channel** (SSE) so clients subscribe by `turnId` and receive the same stream as streaming POST; and **workflow execution** is **queued** (DB-backed job queue with bounded concurrency) so start/resume/scheduled runs are serialized and observable. For details, see [Event-driven architecture](https://docs.agentron.rocks/concepts/event-driven-architecture) in the docs.

## Getting started

### Prerequisites

- Node.js version in [.nvmrc](.nvmrc) (e.g. 22.x)
- npm or pnpm

### Installation

1. Clone the repo and enter the project: `git clone <repo-url> && cd agentron`
2. Install dependencies: `npm run install:ui` or `pnpm install` (UI only) or `npm install` (full, including desktop)
3. Run the app: `npm run dev:ui` or `pnpm run dev:ui`, then open http://localhost:3000

**Desktop app:** Install Agentron as a standalone Electron app (no Node.js required). Download installers from the [Download](https://docs.agentron.rocks/download) page or [GitHub Releases](https://github.com/cap-jmk-real/agentron/releases). The app starts the UI and stores data locally.

Full steps, troubleshooting, and desktop build: [INSTALL.md](INSTALL.md).

### Usage

After starting the app, open **Chat** and try: *"What tools do I have?"* or *"Create a simple agent that says hello."* The assistant uses tools to create and edit agents, workflows, and tools. See [Quick start](https://docs.agentron.rocks/quick-start) in the docs for more prompts.

## Project structure

| Path | Description |
|------|-------------|
| `packages/ui` | Next.js UI |
| `packages/runtime` | Local runtime (agent execution) |
| `packages/core` | Shared types and utilities |
| `apps/desktop` | Electron wrapper |
| `installers` | Local LLM installer scripts |

## Development

### Dependency isolation (UI vs Desktop)

To avoid pulling the Electron toolchain during UI work:

```bash
npm run install:ui
npm run dev:ui
```

When you need desktop packaging:

```bash
npm run install:desktop
```

### Match CI locally

Use the same checks as CI before pushing:

1. **Node:** Use the version in `.nvmrc` (e.g. `nvm use` or `fnm use`).
2. **pnpm:** Repo pins `packageManager` in `package.json`; with Corepack enabled (`corepack enable`) you get the same pnpm version as CI.
3. **Install:** Run `pnpm install --frozen-lockfile` (or at least `pnpm install`) so dependencies match the lockfile.
4. **Run CI checks:** `pnpm run ci:local` runs format:check, typecheck, lint, test:coverage, file-lengths, build:docs, plus build:ui and desktop dist.

### E2E tests with local LLMs (optional)

From repo root:

```bash
npm run test:e2e-llm
```

The script starts Ollama if needed and pulls the default E2E model if missing. **Prerequisites:** [Ollama](https://ollama.com) installed. Optional: Podman for run-code and container scenarios. **Default model:** Qwen 3 8B (`qwen3:8b`). Override with `E2E_LLM_MODEL` (e.g. `E2E_LLM_MODEL=qwen2.5:3b npm run test:e2e-llm`). These tests are not run in CI.

| Model | Env | Notes |
|-------|-----|------|
| Qwen 3 8B (default) | `E2E_LLM_MODEL=qwen3:8b` | Better for heap e2e |
| Qwen 3 14B | `E2E_LLM_MODEL=qwen3:14b` | Larger, higher quality |
| Qwen 2.5 3B | `E2E_LLM_MODEL=qwen2.5:3b` | Faster, smaller |
| Llama 3.2 | `E2E_LLM_MODEL=llama3.2` | Meta model; script auto-pulls if missing |
| Phi-3 | `E2E_LLM_MODEL=phi3` | Microsoft small, fast; script auto-pulls if missing |

Optional env: `OLLAMA_BASE_URL` (default `http://localhost:11434`), `E2E_SAVE_ARTIFACTS=1`, `E2E_LOG_DIR`.

**Optional dependencies:** To build the UI or run tests with coverage, optional deps must be installed. Set `optional=true` in `.npmrc` or run `npm install --include=optional`. CI uses `npm install --include=optional`.

## Documentation

- [Documentation site](https://docs.agentron.rocks/) (concepts, quick start, tutorials, capabilities)
- [Agent architectures (comparison)](https://docs.agentron.rocks/concepts/agent-architectures) (Level 1–4 taxonomy; where Agentron fits)
- [INSTALL.md](INSTALL.md) (install, troubleshoot, desktop build)
- [Download](https://docs.agentron.rocks/download) (desktop installers)

## License

See [LICENSE](LICENSE).
