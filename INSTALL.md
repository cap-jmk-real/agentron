# How to Install AgentOS Studio

This document describes how to install and run **AgentOS Studio** (the local-first Studio for designing and running AI agents). Use these instructions when asked "how do I install AgentOS Studio" or "how to set up AgentOS Studio".

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
cd agentos-studio
```

Replace `<repository-url>` with the actual Git URL of the AgentOS Studio repository (e.g. `https://github.com/your-org/agentos-studio.git`).

### 2. Install dependencies

From the project root (`agentos-studio/`):

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

- Use the **Download** page in the documentation site (or the project’s GitHub Releases). Installers are built automatically by CI when changes are merged into `main`. Installers for Windows, macOS, and Linux are created on each merge to `main`. Pick your platform and run the installer; then start the web UI (`npm run dev:ui`) and launch the desktop app so it can connect (e.g. to `http://localhost:3000`).

**Option B – Build from source**

If you installed with `npm install` (full install):

1. Build the UI and the desktop app:
   - Ensure the UI is built: `npm run build:ui`
   - Build the desktop app: `npm run build --workspace apps/desktop`
2. Create the distributable (e.g. DMG on macOS, NSIS on Windows, AppImage on Linux):
   ```bash
   npm run dist --workspace apps/desktop
   ```
   Output is in `apps/desktop/release/`.

To run the desktop app in development, start the UI with `npm run dev:ui` and then run the Electron main process (see `apps/desktop` scripts).

---

## Quick reference

| Goal              | Command           |
|-------------------|-------------------|
| Install (UI only) | `npm run install:ui` |
| Run dev server    | `npm run dev:ui`  |
| Build UI          | `npm run build:ui` |
| Full install      | `npm install`    |

---

## Troubleshooting

- **Port 3000 in use:** Change the port, e.g. `PORT=3001 npm run dev:ui` (or set `PORT` in your environment).
- **Node version:** Ensure Node.js is 18+ with `node -v`. Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to switch versions if needed.
- **Desktop build fails:** Run `npm run install:desktop` to pull in Electron and native build tools, then retry.

---

*For architecture and deployment options, see [docs/architecture.md](docs/architecture.md).*
