# Agentron — Enterprise-Ready Local AI Agent Orchestration & Automation

[![CI](https://github.com/cap-jmk-real/agentron/actions/workflows/ci.yml/badge.svg)](https://github.com/cap-jmk-real/agentron/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/cap-jmk-real/agentron/graph/badge.svg)](https://codecov.io/gh/cap-jmk-real/agentron)
[![Lines of code](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cap-jmk-real/agentron/main/badges/loc.json)](https://github.com/cap-jmk-real/agentron)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Local-first](https://img.shields.io/badge/local--first-sqlite%20%2B%20Electron-8B5CF6)](INSTALL.md)

**Agentron** is an **enterprise-ready, local-first** platform for **AI agent orchestration** and **workflow automation**. Design and run multi-agent systems entirely on your own infrastructure—no cloud lock-in, full data privacy, and optional desktop deployment.

- **Local-first & self-hosted** — SQLite storage, optional Electron desktop app; run on-premise or air-gapped.
- **Visual agent builder** — Node-based graphs (LLM, tools, decision nodes) plus code agents (JavaScript/Python/TypeScript) in sandboxes.
- **Multi-agent workflows** — Orchestrate agents in graphs with configurable rounds; built-in chat assistant that creates and edits agents, workflows, and tools via natural language.
- **Tools & integrations** — Native, HTTP, and MCP tools; RAG/knowledge; Podman sandboxes; OpenAI, Anthropic, Ollama, and remote LLM support; OpenClaw gateway integration (send commands, history, abort) for steering a local OpenClaw instance from chat.

Ideal for teams that need **local AI automation**, **privacy-first agent orchestration**, and **multi-agent workflow** control without depending on cloud-only platforms.

## How to install Agentron

**Prerequisites:** Node.js version in `.nvmrc` (e.g. 22.x) and npm or pnpm.

1. Clone the repo and enter the project: `git clone <repo-url> && cd agentron`
2. Install dependencies: `npm run install:ui` or `pnpm install` (UI only) or `npm install` (full, including desktop)
3. Run the app: `npm run dev:ui` or `pnpm run dev:ui` then open http://localhost:3000

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

## E2E tests with local LLMs (optional)

Run end-to-end tests against a real local LLM (Ollama). **Single command** (from repo root):

```bash
npm run test:e2e-llm
```

The script starts Ollama if needed, **pulls the default E2E model if missing**, then runs the E2E suite. No manual `ollama pull` required.

**Prerequisites:** [Ollama](https://ollama.com) installed. Optional: Podman for run-code and container scenarios. (In the app we plan to offer one-click model pull from the UI so users do not need to run `ollama pull` manually.)

**Default model:** Qwen 2.5 3B (`qwen2.5:3b`). Override with `E2E_LLM_MODEL` (e.g. `E2E_LLM_MODEL=llama3.2 npm run test:e2e-llm`); the script will pull that model if missing.

**Example configs (suggested models):**

| Model                 | Env                                    | Notes                             |
| --------------------- | -------------------------------------- | --------------------------------- |
| Qwen 2.5 3B (default) | *(none)* or `E2E_LLM_MODEL=qwen2.5:3b` | Good balance of quality and speed |
| Llama 3.2              | `E2E_LLM_MODEL=llama3.2`               | Script auto-pulls if missing      |
| Phi-3                  | `E2E_LLM_MODEL=phi3`                   | Script auto-pulls if missing      |

**Optional env:** `OLLAMA_BASE_URL` (default `http://localhost:11434`), `E2E_SAVE_ARTIFACTS=1`, `E2E_LOG_DIR`.

These tests are **not** run in CI.

**Optional dependencies:** A plain `npm install` works on all platforms (Windows, Linux, macOS). We omit optional deps by default (see `.npmrc`). To **build the UI** (e.g. `npm run build:ui`) or run tests with coverage, optional deps must be installed (Next.js SWC and tooling). Set `optional=true` in `.npmrc`, or run `npm install --include=optional` after your first install. The desktop app also needs optional deps (e.g. `sharp`) for icon export; CI uses `npm install --include=optional` (and for desktop: `npm install --include=optional sharp --workspace apps/desktop`).
