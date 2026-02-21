#!/usr/bin/env node
/**
 * Runs a script in a workspace using the appropriate package manager (npm or pnpm).
 * Usage: node scripts/run-workspace.mjs <workspace> <script> [args...]
 *   workspace: path (e.g. packages/ui) or "all" for all workspaces
 *   script: script name (e.g. test, build)
 * Example: node scripts/run-workspace.mjs packages/ui test
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const workspace = process.argv[2];
const script = process.argv[3];
const extraArgs = process.argv.slice(4);

if (!workspace || !script) {
  console.error("Usage: node scripts/run-workspace.mjs <workspace|all> <script> [args...]");
  process.exit(1);
}

// Use the package manager that invoked this script (npm sets npm_config_user_agent; pnpm includes "pnpm")
const userAgent = process.env.npm_config_user_agent || "";
const usePnpm = userAgent.includes("pnpm");

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", cwd: root, ...opts });
}

if (workspace === "all") {
  if (usePnpm) {
    const args = ["-r", "run", script, ...(extraArgs.length ? ["--", ...extraArgs] : [])];
    run(`pnpm ${args.join(" ")}`);
  } else {
    const args = [
      "run",
      script,
      "--workspaces",
      "--if-present",
      ...(extraArgs.length ? ["--", ...extraArgs] : []),
    ];
    run(`npm ${args.join(" ")}`);
  }
  process.exit(0);
}

// Single workspace
if (usePnpm) {
  const pkgPath = resolve(root, workspace, "package.json");
  if (!existsSync(pkgPath)) {
    console.error(`Workspace not found: ${workspace}`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const pkgName = pkg.name;
  const args = [
    "--filter",
    pkgName,
    "run",
    script,
    ...(extraArgs.length ? ["--", ...extraArgs] : []),
  ];
  run(`pnpm ${args.join(" ")}`);
} else {
  const args = [
    "run",
    script,
    `--workspace=${workspace}`,
    ...(extraArgs.length ? ["--", ...extraArgs] : []),
  ];
  run(`npm ${args.join(" ")}`);
}
