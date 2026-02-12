# AgentOS Studio

[![CI](https://github.com/agentron-studio/agentron/actions/workflows/ci.yml/badge.svg)](https://github.com/agentron-studio/agentron/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-50%25%2B-brightgreen)](packages/ui/__tests__/README.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Local-first](https://img.shields.io/badge/local--first-sqlite%20%2B%20Electron-8B5CF6)](INSTALL.md)

Local-first Studio for designing and running agents. Runs as a Next.js app with an Electron wrapper.

## How to install AgentOS Studio

**Prerequisites:** Node.js 18+ and npm.

1. Clone the repo and enter the project: `git clone <repo-url> && cd agentos-studio`
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

