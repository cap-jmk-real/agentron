/**
 * Copies the Next.js standalone build from packages/ui into apps/desktop/standalone
 * so electron-builder can include it. Run after: npm run build:ui (from repo root).
 * Next.js standalone does not include .next/static or public; we copy them in.
 *
 * When the standalone output contains broken symlinks (e.g. pnpm layout on Linux/macOS),
 * we resolve the package from the repo root node_modules and copy it so the build does
 * not fail and the packaged app has all required deps.
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const uiDir = path.join(repoRoot, "packages", "ui");
const standaloneSource = path.join(uiDir, ".next", "standalone");
const staticSource = path.join(uiDir, ".next", "static");
const publicSource = path.join(uiDir, "public");
const desktopDir = path.join(repoRoot, "apps", "desktop");
const standaloneOut = path.join(desktopDir, "standalone");

const pnpmNodeModules = path.join(standaloneSource, "node_modules", ".pnpm", "node_modules");

/**
 * Derive a require()-style package name from a path under standalone/node_modules.
 * e.g. .../node_modules/.pnpm/node_modules/semver -> "semver"
 *      .../node_modules/.pnpm/node_modules/@babel/core -> "@babel/core"
 */
function packageNameFromStandalonePath(srcPath) {
  if (!srcPath.startsWith(pnpmNodeModules + path.sep) && srcPath !== pnpmNodeModules) {
    return path.basename(srcPath);
  }
  const rel = path.relative(pnpmNodeModules, srcPath);
  const first = rel.split(path.sep)[0];
  if (first && first.startsWith("@")) {
    const second = rel.split(path.sep)[1];
    return second ? first + "/" + second : first;
  }
  return first || path.basename(srcPath);
}

const standaloneNodeModules = path.join(standaloneSource, "node_modules");

/**
 * Resolve package from repo (root or packages/ui) and return its root dir.
 * Tries require.resolve first, then the pnpm layout path implied by the broken symlink.
 */
function resolvePackageFromRepo(packageName, brokenSymlinkPath) {
  for (const searchRoot of [repoRoot, uiDir]) {
    try {
      const pkgJsonPath = require.resolve(packageName + "/package.json", { paths: [searchRoot] });
      return path.dirname(pkgJsonPath);
    } catch {
      // continue
    }
  }
  // Fallback: symlink target path in standalone may mirror repo layout (e.g. .pnpm/semver@x/node_modules/semver)
  if (brokenSymlinkPath && brokenSymlinkPath.startsWith(standaloneNodeModules + path.sep)) {
    try {
      const linkTarget = fs.readlinkSync(brokenSymlinkPath);
      const targetInStandalone = path.resolve(path.dirname(brokenSymlinkPath), linkTarget);
      const relFromNodeModules = path.relative(standaloneNodeModules, targetInStandalone);
      if (!relFromNodeModules.startsWith("..")) {
        for (const searchRoot of [uiDir, repoRoot]) {
          const candidate = path.join(searchRoot, "node_modules", relFromNodeModules);
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function copyOne(srcPath, destPath, copyRecursiveRef) {
  let stat;
  try {
    stat = fs.lstatSync(srcPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `prepare-standalone: missing or broken path (cannot stat). ` +
          `Standalone output may contain broken symlinks. Path: ${srcPath}`
      );
    }
    throw err;
  }
  if (stat.isSymbolicLink()) {
    let target;
    try {
      target = fs.realpathSync(srcPath);
    } catch (err) {
      if (err.code === "ENOENT") {
        const packageName = packageNameFromStandalonePath(srcPath);
        const repoPkgRoot = resolvePackageFromRepo(packageName, srcPath);
        if (repoPkgRoot && fs.existsSync(repoPkgRoot)) {
          console.warn(
            `prepare-standalone: broken symlink at ${path.relative(repoRoot, srcPath)} -> copying "${packageName}" from repo`
          );
          copyRecursiveRef(repoPkgRoot, destPath);
          return;
        }
        throw new Error(
          `prepare-standalone: broken symlink (target missing in standalone) and could not resolve "${packageName}" from repo. ` +
            `Path: ${srcPath}`
        );
      }
      throw err;
    }
    stat = fs.statSync(target);
    if (stat.isDirectory()) {
      copyRecursiveRef(target, destPath);
      return;
    }
    srcPath = target;
  } else if (stat.isDirectory()) {
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
