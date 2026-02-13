/**
 * Rebuild better-sqlite3 in the standalone output for Electron's Node ABI.
 * Next.js standalone copies the module from the build Node version; the packaged
 * app runs inside Electron (different ABI), so we run node-gyp in the standalone
 * copy only (avoids EPERM and wrong-path issues with electron-rebuild in a monorepo).
 * Run after prepare-standalone.cjs, before electron-builder.
 *
 * Requires on Windows: Visual Studio 2022 Build Tools with the "Desktop development
 * with C++" workload (or at least the MSVC C++ toolset). Install via the
 * Visual Studio Installer → Modify → check "Desktop development with C++".
 *
 * To build the installer without rebuilding (e.g. no C++ tools): set
 * SKIP_STANDALONE_NATIVE_REBUILD=1. The packaged app may then fail to load
 * better-sqlite3 until you run this step with a proper VS setup.
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const standaloneDir = path.join(desktopDir, "standalone");
const nextNodeModules = path.join(standaloneDir, "packages", "ui", ".next", "node_modules");

function getElectronVersion() {
  const candidates = [
    path.join(desktopDir, "node_modules", "electron", "package.json"),
    path.join(repoRoot, "node_modules", "electron", "package.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j.version;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(standaloneDir)) {
    console.error("Standalone not found. Run prepare:standalone first.");
    process.exit(1);
  }

  if (!fs.existsSync(nextNodeModules)) {
    console.log("No .next/node_modules in standalone, skipping native rebuild.");
    return;
  }

  const entries = fs.readdirSync(nextNodeModules, { withFileTypes: true });
  const betterSqlite3Dir = entries
    .filter((d) => d.isDirectory() && d.name.startsWith("better-sqlite3"))
    .map((d) => path.join(nextNodeModules, d.name))
    .find((dir) => fs.existsSync(path.join(dir, "binding.gyp")));

  if (!betterSqlite3Dir) {
    console.log("better-sqlite3 (with binding.gyp) not found in .next/node_modules, skipping rebuild.");
    return;
  }

  if (process.env.SKIP_STANDALONE_NATIVE_REBUILD === "1") {
    console.warn(
      "SKIP_STANDALONE_NATIVE_REBUILD=1: skipping better-sqlite3 rebuild. Packaged app may fail to use the DB."
    );
    return;
  }

  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    console.error("Electron not found. Install with: npm install (from repo root or apps/desktop)");
    process.exit(1);
  }

  const nodeGypPath = path.join(repoRoot, "node_modules", "node-gyp", "bin", "node-gyp.js");
  if (!fs.existsSync(nodeGypPath)) {
    console.error("node-gyp not found at", nodeGypPath, "- ensure dependencies are installed.");
    process.exit(1);
  }

  const arch = process.arch;
  const headerURL = "https://www.electronjs.org/headers";

  console.log("Rebuilding better-sqlite3 for Electron", electronVersion, "in:", betterSqlite3Dir);
  try {
    execSync(
      `node "${nodeGypPath}" rebuild --runtime=electron --target=${electronVersion} --dist-url=${headerURL} --arch=${arch} --build-from-source`,
      {
        cwd: betterSqlite3Dir,
        stdio: "inherit",
        shell: true,
        env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE || standaloneDir },
      }
    );
  } catch (err) {
    console.error("node-gyp rebuild failed:", err.message);
    console.error("");
    console.error("On Windows you need Visual Studio 2022 Build Tools with the C++ toolset:");
    console.error("  1. Open 'Visual Studio Installer'");
    console.error("  2. Click 'Modify' on Visual Studio Build Tools 2022");
    console.error("  3. Check 'Desktop development with C++' (or at least the MSVC toolset)");
    console.error("  4. Install, then run: npm run dist:desktop");
    console.error("");
    console.error("To build the installer without rebuilding (app may fail at runtime):");
    console.error("  set SKIP_STANDALONE_NATIVE_REBUILD=1 && npm run dist:desktop");
    process.exit(1);
  }

  console.log("Standalone better-sqlite3 rebuilt for Electron.");
}

main();
