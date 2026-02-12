# Electron automatic builds, download page, and GitHub Pages docs

## Overview

- **Electron**: GitHub Actions build the desktop app for Windows, macOS, and Linux on tag push; publish to GitHub Releases.
- **Download page**: Add a page in the docs that detects platform and lets users select OS, linking to the latest release assets.
- **Docs hosting**: Automatically build and deploy the Docusaurus docs to GitHub Pages on push (e.g. main).

---

# Part 1: Electron automatic builds and download page

## Current state

- **Desktop app**: [apps/desktop](apps/desktop) uses **electron-builder** (Windows NSIS, macOS DMG, Linux AppImage). UI is loaded from URL (`AGENTRON_STUDIO_URL` or `http://localhost:3000`).
- **Build**: From root: `npm run build:ui` then `npm run build --workspace apps/desktop` then `npm run dist --workspace apps/desktop`; output in `apps/desktop/release/`.
- **Docs**: [apps/docs](apps/docs) (Docusaurus); good place for the Download page.

**Note:** Packaged app currently expects the UI to be served. A fully offline experience would require bundling the Next.js UI into Electron later.

---

## 1. GitHub Actions: build and publish to Releases

- **Workflow**: `.github/workflows/release-desktop.yml` — trigger on tag `v*`.
- **Matrix**: Build on `windows-latest`, `macos-latest`, `ubuntu-latest`. Each job: checkout, Node 20, install from root, `npm run build:ui`, then build desktop and `npm run dist --workspace apps/desktop`; upload `apps/desktop/release/` as artifact.
- **Release**: One job runs after all three; downloads all artifacts and uses **softprops/action-gh-release** to create the release for the tag and attach the built installers. Use default `GITHUB_TOKEN`; no signing in the first step.

**Files to add:** `.github/workflows/release-desktop.yml`

---

## 2. Download page (in docs)

- New doc in [apps/docs](apps/docs), e.g. `docs/download.md`, with platform detection and platform selector (Windows / macOS / Linux).
- **Links**: Use GitHub API `GET /repos/OWNER/REPO/releases/latest` from the browser; map `assets[].browser_download_url` by filename (`.exe`, `.dmg`, `.AppImage`). Fallback: link to Releases page.
- **Nav**: Add "Download" to [apps/docs/docusaurus.config.js](apps/docs/docusaurus.config.js) navbar.
- **Repo**: Use configurable repo (e.g. from docusaurus `organizationName` / `projectName` or env) for API URL.

---

# Part 2: Host docs on GitHub Pages automatically

## Goal

On every push to the default branch (e.g. `main`), build the Docusaurus site and deploy it to GitHub Pages so the docs are always up to date without manual builds.

## 2.1 GitHub Pages setup (one-time, in repo settings)

- **Settings → Pages**: Source = **GitHub Actions** (not “Deploy from a branch”). No need for a `gh-pages` branch; the workflow will use the “Upload artifact” + “Deploy to GitHub Pages” approach.
- If using a custom domain (e.g. agentos.dev), configure it in the same Pages settings; otherwise the site will be at `https://<owner>.github.io/<repo>/`.

## 2.2 baseUrl for GitHub Pages

- For **project site** (e.g. `https://agentos.github.io/agentos-studio/`), Docusaurus must use **baseUrl: '/agentos-studio/'** (trailing slash, repo name). Currently [apps/docs/docusaurus.config.js](apps/docs/docusaurus.config.js) has `baseUrl: '/'` and `url: 'https://agentos.dev'`.
- **Options:**
  - **Custom domain**: If you point agentos.dev to GitHub Pages, keep `url: 'https://agentos.dev'` and `baseUrl: '/'` and set the custom domain in Pages settings.
  - **Default GitHub Pages URL** (e.g. `https://<owner>.github.io/agentron/`): Set `url` to that origin and `baseUrl: '/agentron/'` (or your repo name). Use an environment variable or build arg in the workflow so the same config can build for either (e.g. `BASE_URL` / `DEPLOY_URL`).

**Recommendation:** Add optional env in the workflow, e.g. `BASE_URL` defaulting to `/${{ github.event.repository.name }}/` when deploying to GitHub Pages, and in docusaurus.config.js use `baseUrl: process.env.BASE_URL || '/'` (and same for `url` if needed). So: one workflow; when run by GitHub Actions for Pages, set `BASE_URL=/repo-name/` and `URL=https://<owner>.github.io/repo-name` so assets and links work.

## 2.3 Workflow: build and deploy

- **New file**: `.github/workflows/deploy-docs.yml`
- **Trigger:** `push` to `main` (or your default branch), and optionally `workflow_dispatch`.
- **Permissions:** `contents: read`, `pages: write`, `id-token: write` (required for deploy-pages).
- **Jobs:**
  1. **Build**
     - Checkout repo.
     - Setup Node (e.g. 20).
     - Install dependencies from **repo root** (so workspace deps for `apps/docs` are available): `npm ci` or `pnpm install --frozen-lockfile`.
     - Build docs: `npm run build:docs` (from root; see [package.json](package.json) scripts). Docusaurus outputs to `apps/docs/build` by default.
     - Set `baseUrl` (and `url` if not custom domain) for GitHub Pages: e.g. pass `BASE_URL=/${{ github.event.repository.name }}/` and `URL=https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}/` as env when running the build, and ensure docusaurus.config.js reads them (see below).
  2. **Deploy**
     - Use **actions/upload-pages-artifact**: upload the contents of `apps/docs/build` (path: `apps/docs/build` or move `build` to root and use `path: build` — upload-pages-artifact expects a directory). So set `path: apps/docs/build` in upload-pages-artifact.
     - Use **actions/deploy-pages** (in the same job or a dependent job that runs after upload). No need for a separate “release” job; the deploy job runs after the build job and uses the uploaded artifact.

**docusaurus.config.js changes**

- Read `process.env.BASE_URL` and `process.env.URL` (or `process.env.GH_PAGES_URL`) so the workflow can set them for GitHub Pages. Example:
  - `baseUrl: process.env.BASE_URL || '/'`
  - `url: process.env.URL || 'https://agentos.dev'`
- When building locally or for a custom domain, omit these env vars. When building in CI for GitHub Pages, set them so the generated HTML and assets use the correct base path.

## 2.4 Monorepo install

- From repo root, run `npm ci` (or `pnpm install --frozen-lockfile`). Then run the docs build; the root [package.json](package.json) has `"build:docs": "npm run build --workspace apps/docs"` (or equivalent). Ensure `apps/docs` has no hoisting issues; if the docs app has no workspace deps, you can alternatively `cd apps/docs && npm ci && npm run build` and use that build output — but using the root install is consistent with the rest of the repo.

## Summary (GitHub Pages)

| Step | What |
|------|------|
| **Repo** | Settings → Pages → Source = **GitHub Actions**. |
| **Config** | In [apps/docs/docusaurus.config.js](apps/docs/docusaurus.config.js), use `process.env.BASE_URL` / `process.env.URL` for baseUrl and url when set (for GitHub Pages). |
| **Workflow** | `.github/workflows/deploy-docs.yml`: on push to main, install from root, build docs with BASE_URL/URL set for GitHub Pages, upload `apps/docs/build` with **actions/upload-pages-artifact**, then **actions/deploy-pages**. |

After the first run, the site will be at `https://<owner>.github.io/<repo>/` (or your custom domain if configured).
