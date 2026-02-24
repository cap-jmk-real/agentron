# Agentron Documentation

Hostable documentation built with [Nextra](https://nextra.site/): the same framework used by many Next.js documentation sites.

## Purpose

This documentation is designed for:
- **AI assistants and LLMs**: To understand concepts (tools, agents, workflows, assistant) and suggest actions to users
- **Developers**: Architecture and feature reference

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

- `content/index.mdx`: Overview for AIs
- `content/concepts/`: Tools, agents, workflows, assistant
- `content/capabilities.mdx`: Feature matrix
- `content/ai-guide.mdx`: Decision tree for suggesting user actions
