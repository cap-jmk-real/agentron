# How to Install Agentron

This document describes how to install and run **Agentron** (enterprise-ready local AI agent orchestration and automation). Use these instructions when asked "how do I install Agentron" or "how to set up Agentron".

---

## Prerequisites

- **Node.js** 18 or later (LTS recommended). Check with: `node -v`
- **npm** (included with Node.js). Check with: `npm -v`
- **Git** (to clone the repository)

---

## Installation Steps

### 1. Clone the repository

```bash
git clone <repository-url>
cd agentron
```

Replace `<repository-url>` with the actual Git URL of the Agentron repository (e.g. `https://github.com/cap-jmk-real/agentron.git`).

### 2. Install dependencies

From the project root (`agentron/`):

**Option A – UI only (recommended for most users; avoids Electron toolchain)**

```bash
npm run install:ui
```

**Option B – Full install (includes desktop app dependencies)**

```bash
npm install
```

If you only need the web UI, use Option A. Use Option B if you plan to build or run the Electron desktop app.

### 3. Run the application

**Run the web UI (Next.js)**

```bash
npm run dev:ui
```

Then open a browser at **http://localhost:3000**.

**Production build and run (optional)**

```bash
npm run build:ui
npm --workspace packages/ui run start
```

---

## Running the desktop app (Electron)

**Option A – Download a pre-built installer (recommended)**

- Use the **Download** page in the documentation site (or the project’s GitHub Releases). Installers are built automatically by CI when changes are merged into `main`. Pick your platform and run the installer. When you launch the desktop app, it **starts the UI server automatically** (no need to run `npm run dev:ui`). Data (SQLite, uploads) is stored in the app’s user data directory. **Requirement:** Node.js 18+ must be installed and on your PATH so the bundled server can start; if Node is not found, set `AGENTRON_STUDIO_URL` to a running UI (e.g. `http://localhost:3000`) and start the UI separately.

**Option B – Build from source**

If you installed with `npm install` (full install):

1. **Run the Electron app locally (no installer):**
   - In one terminal, start the UI: `npm run dev:ui`
   - In another, build and run the desktop app: `npm run start:desktop`
   - Or from the repo root: `npm run build:desktop` then `npx electron apps/desktop` (with the UI already running at http://localhost:3000).

2. **Create the distributable** (installer: DMG on macOS, NSIS on Windows, AppImage on Linux):
   ```bash
   npm run dist:desktop
   ```
   This builds the UI, builds the desktop app, and runs electron-builder. Output is in `apps/desktop/release/`.
   - Alternatively: `npm run build:desktop` then `npm run dist --workspace apps/desktop`.

---

## Quick reference

| Goal | Command |
|------|---------|
| Install (UI only) | `npm run install:ui` |
| Run dev server | `npm run dev:ui` |
| Build UI | `npm run build:ui` |
| Run Electron app locally | `npm run dev:ui` (terminal 1), then `npm run start:desktop` (terminal 2) |
| Build desktop (UI + Electron bundle) | `npm run build:desktop` |
| Build installer (NSIS/DMG/AppImage) | `npm run dist:desktop` |
| Full install | `npm install` |

---

## Troubleshooting

- **Port 3000 in use:** Change the port, e.g. `PORT=3001 npm run dev:ui` (or set `PORT` in your environment).
- **Node version:** Ensure Node.js is 18+ with `node -v`. Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to switch versions if needed.
- **Desktop build fails:** Run `npm run install:desktop` to pull in Electron and native build tools, then retry.

---

*For architecture and deployment options, see [docs/architecture.md](docs/architecture.md).*
