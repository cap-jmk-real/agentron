# Desktop app: standalone (install-only) experience

**Goal:** The desktop app should work **independently** after install. Users install only via the installer (NSIS/DMG/AppImage); one double-click and the app runs.

## Implemented behavior

- **Packaged app:** When you run the installed desktop app, it starts the bundled Next.js UI server (from `resources/app`) with data stored in the app’s user data directory, then opens the window to it. No separate “run the UI” step.
- **Development:** When not packaged, the app loads `AGENTRON_STUDIO_URL` or `http://localhost:3000` (you run `npm run dev:ui` separately). The web app (Next.js only, no Electron) works the same for DB and LLM providers.
- **CI:** The Release Desktop workflow adds the VS C++ workload on Windows before building, so the native rebuild runs and the Windows installer has a working DB. To skip the rebuild (e.g. local build without VS), set `SKIP_STANDALONE_NATIVE_REBUILD=1` (when skipped, the packaged app may fail to use the DB until rebuilt with the “Desktop development with C++” workload).

**Bundling Node in the installer:** Node is **bundled by default**. The `dist` script runs `download:node-runtime` before electron-builder, so every installer build includes the Node version from repo root `.nvmrc` for the current platform. Users do not need to install Node. If the bundled server fails to start for any other reason, the app shows a dialog with “Open download page” (nodejs.org) and “Quit”.

## Approach: bundle Next.js standalone inside Electron

1. **Next.js standalone output**  
   Build the UI with `output: 'standalone'` in `next.config`. This produces a self-contained Node server (e.g. `server.js` plus `.next/standalone`, `.next/static`, `public`) that can run with `node server.js`.

2. **Packaging**  
   - Build the UI in standalone mode (e.g. from `packages/ui`).
   - Include the standalone output in the Electron app bundle (e.g. via `electron-builder` `extraResources` or `files` so the unpacked app has something like `resources/app/` containing the standalone server).

3. **Electron main process at runtime**  
   - **Packaged app** (`app.isPackaged`):  
     - Resolve the path to the bundled standalone server (e.g. `path.join(process.resourcesPath, 'app')` or similar, depending on how you package).  
     - Spawn the server: e.g. `node server.js` with `cwd` set to that path and `PORT` set to a chosen port (fixed or random free port).  
     - Wait until the server is listening (e.g. poll `http://localhost:PORT` or read stdout).  
     - Create the `BrowserWindow` and load `http://localhost:PORT`.  
   - **Development** (not packaged):  
     - Keep current behavior: load `AGENTRON_STUDIO_URL` or `http://localhost:3000` (user runs `npm run dev:ui` separately).

4. **Node for the bundled server**  
   - Either bundle a Node binary (e.g. in `extraResources`) and run it when starting the server, or document a minimum Node version and use `process.execPath` or a well-known system Node (bundling is more reliable for “install only”).

5. **Data directory**  
   - Use `app.getPath('userData')` for SQLite DB, uploads, and any local state so the bundled app stores data in the correct user directory on each OS (no write to read-only app bundle).

## Implementation checklist (high level)

- [x] **Next.js**: `output: 'standalone'` in `packages/ui/next.config.mjs`; `serverExternalPackages: ["better-sqlite3"]` kept for standalone.
- [x] **Build pipeline**: `apps/desktop/scripts/prepare-standalone.cjs` copies UI standalone + `.next/static` into `apps/desktop/standalone`; `dist` runs it before electron-builder.
- [x] **electron-builder**: `extraResources` includes `standalone` → `app` so the packaged app has `resources/app/` with the Next server.
- [x] **Electron main**: In `apps/desktop/src/main.ts`, when `app.isPackaged`, spawn `node server.js` from `resources/app/packages/ui` with `AGENTRON_DATA_DIR` = `app.getPath('userData')` and `PORT` = 3000; wait for server ready then load the window; on quit kill the subprocess.
- [x] **Port**: Fixed port 3000; passed via `PORT` to the standalone server.
- [x] **Data path**: UI uses `AGENTRON_DATA_DIR` (and `getDataDir()` / `getRagUploadsDir()` etc.) so when Electron sets it to `userData`, SQLite and all files go to the app data directory.
- [x] **Cleanup**: `before-quit` kills the server process.
- [x] **Optional:** Bundle Node via `download:node-runtime` script and platform `extraResources` (`node-runtime-win`, `node-runtime-darwin`, `node-runtime-linux` → `app/node`). When present, the app uses the bundled Node; otherwise it uses system Node and shows a dialog if missing.

## References

- Next.js [Standalone Output](https://nextjs.org/docs/app/api-reference/next-config-js/output#standalone).
- electron-builder [extraResources](https://www.electron.build/configuration/contents#extraresources) and packaging.
- Existing pattern: [Building an App with Next.js and Electron](https://saybackend.com/blog/2024-aug-nextjs-electron-server-components/) (spawn standalone server from Electron).

## Docs and UX

- **INSTALL.md**: Updated: installer users launch the app and the UI server starts automatically; Node.js 18+ on PATH is required unless a Node binary is bundled later.
- **Download / README**: Can state that the installer is self-contained (no separate “run the UI” step); Node.js must be installed for the bundled server to start.
