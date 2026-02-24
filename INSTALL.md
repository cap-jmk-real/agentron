# How to Install Agentron

This document describes how to install and run **Agentron** (enterprise-ready local AI agent orchestration and automation). Use these instructions when asked "how do I install Agentron" or "how to set up Agentron".

---

## Prerequisites

- **Node.js** — version in repo root `.nvmrc` (e.g. 22.x). Check with: `node -v`
- **npm** (included with Node.js) or **pnpm**. Check with: `npm -v` or `pnpm -v`
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
# or with pnpm: pnpm install
```

**Option B – Full install (includes desktop app dependencies)**

```bash
npm install
# or with pnpm: pnpm install
```

If you only need the web UI, use Option A. Use Option B if you plan to build or run the Electron desktop app. Both **npm** and **pnpm** are supported; scripts detect the package manager automatically.

**Building and tests:** A plain `npm install` works on all platforms. The repo omits optional dependencies by default (`.npmrc`). To build the UI (`npm run build:ui`) or run tests with coverage, set `optional=true` in `.npmrc`, or run `npm install --include=optional` after installing.

### 3. Run the application

**Run the web UI (Next.js)**

```bash
npm run dev:ui
```

Then open a browser at **http://localhost:3000**.

**Production build and run (optional)**

```bash
npm run build:ui
npm run build:ui && node scripts/run-workspace.mjs packages/ui start
```

---

## Running the desktop app (Electron)

**Option A – Download a pre-built installer (recommended)**

- Use the **Download** page in the documentation site (or the project’s GitHub Releases). Installers are built automatically by CI when changes are merged into `main`. Pick your platform and run the installer. When you launch the desktop app, it **starts the UI server automatically** (no need to run `npm run dev:ui`). Data (SQLite, uploads) is stored in the app’s user data directory. **Node.js is bundled in the installer**, so users do not need to install Node separately.

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
- **pnpm: Tests fail with "Could not locate the bindings file" (better-sqlite3):** Run `pnpm rebuild better-sqlite3` to compile the native addon.
- **Installed app doesn’t open or window is blank:** The app writes a log file so you can see what failed. Open the log at:
  - **Windows:** `%APPDATA%\Agentron Studio\agentron-desktop.log` (or `%LOCALAPPDATA%\Agentron Studio\agentron-desktop.log` if installed per-user).
  - **macOS:** `~/Library/Application Support/Agentron Studio/agentron-desktop.log`
  - **Linux:** `~/.config/Agentron Studio/agentron-desktop.log`  
  Check for messages like "Server spawn error", "Server exited", or "did-fail-load". If the bundled Node or server fails to start, the log will show the reason.

---

*For architecture and deployment options, see [docs/architecture.md](docs/architecture.md).*
