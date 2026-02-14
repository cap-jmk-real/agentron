# Desktop app assets

## App icon

The app icon is generated at build time from the shared UI icon:

- **Source:** `packages/ui/public/icon.svg` (single source of truth; Next.js serves it at `/icon.svg`)
- **Export:** `npm run prepare-icon` (run automatically before `npm run dist`) converts the SVG to `assets/icon.png` (512×512) for electron-builder.
- **Config:** `package.json` → `build.icon` points to `assets/icon.png`.

No manual export needed. For other logo references, see the repo root: `logo.svg`, `logo-options.html`, `logo-tool-and-loading.html`.
