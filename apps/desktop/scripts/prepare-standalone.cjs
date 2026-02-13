/**
 * Copies the Next.js standalone build from packages/ui into apps/desktop/standalone
 * so electron-builder can include it. Run after: npm run build:ui (from repo root).
 * Next.js standalone does not include .next/static or public; we copy them in.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const uiDir = path.join(repoRoot, "packages", "ui");
const standaloneSource = path.join(uiDir, ".next", "standalone");
const staticSource = path.join(uiDir, ".next", "static");
const publicSource = path.join(uiDir, "public");
const desktopDir = path.join(repoRoot, "apps", "desktop");
const standaloneOut = path.join(desktopDir, "standalone");

function copyOne(srcPath, destPath, copyRecursiveRef) {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    copyRecursiveRef(srcPath, destPath);
    return;
  }
  try {
    fs.copyFileSync(srcPath, destPath);
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EINVAL") {
      fs.writeFileSync(destPath, fs.readFileSync(srcPath));
    } else throw err;
  }
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      copyOne(srcPath, destPath, copyRecursive);
    }
  }
}

function main() {
  if (!fs.existsSync(standaloneSource)) {
    console.error("Standalone build not found. Run from repo root: npm run build:ui");
    process.exit(1);
  }

  if (fs.existsSync(standaloneOut)) {
    fs.rmSync(standaloneOut, { recursive: true, force: true });
  }
  fs.mkdirSync(standaloneOut, { recursive: true });

  // Copy entire standalone output (server.js under packages/ui, node_modules at root, etc.)
  copyRecursive(standaloneSource, standaloneOut);

  // Next.js does not bundle .next/static or public. Server runs from standalone/packages/ui, so put static there.
  const uiStandaloneNext = path.join(standaloneOut, "packages", "ui", ".next");
  if (!fs.existsSync(uiStandaloneNext)) fs.mkdirSync(uiStandaloneNext, { recursive: true });
  if (fs.existsSync(staticSource)) {
    copyRecursive(staticSource, path.join(uiStandaloneNext, "static"));
  }
  const uiPublic = path.join(standaloneOut, "packages", "ui", "public");
  if (fs.existsSync(publicSource)) {
    copyRecursive(publicSource, uiPublic);
  }

  console.log("Standalone app prepared at apps/desktop/standalone");
}

main();
