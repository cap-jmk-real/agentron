# Agentron Documentation

Hostable documentation built with [Docusaurus](https://docusaurus.io/) — the same framework used by React, Jest, and other major projects.

## Purpose

This documentation is designed for:
- **AI assistants and LLMs** — To understand concepts (tools, agents, workflows, assistant) and suggest actions to users
- **Developers** — Architecture and feature reference

## Running Locally

```bash
# From repo root
npm install
npm run dev:docs
```

Then open http://localhost:3000

## Building for Production

```bash
npm run build:docs
```

Output is in `apps/docs/build/`. Deploy to Vercel, Netlify, GitHub Pages, or any static host.

## Structure

- `docs/intro.md` — Overview for AIs
- `docs/concepts/` — Tools, agents, workflows, assistant
- `docs/capabilities.md` — Feature matrix
- `docs/ai-guide.md` — Decision tree for suggesting user actions
