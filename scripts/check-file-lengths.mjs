#!/usr/bin/env node
/**
 * Fail CI if any tracked source file exceeds MAX_LINES.
 * Scans packages/ and apps/ (excluding build/generated dirs).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MAX_LINES = 1000;
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".md", ".mdc", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  "out",
  "release",
  "standalone",
]);

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function* walk(rootDir) {
  if (!fs.existsSync(rootDir)) return;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORED_DIRS.has(ent.name)) continue;
      yield* walk(full);
    } else if (ent.isFile() && EXTENSIONS.has(path.extname(ent.name))) {
      yield full;
    }
  }
}

const packagesDir = path.join(repoRoot, "packages");
const appsDir = path.join(repoRoot, "apps");

const offenders = [];
for (const root of [packagesDir, appsDir]) {
  if (!fs.existsSync(root)) continue;
  for (const filePath of walk(root)) {
    const lines = countLines(filePath);
    if (lines > MAX_LINES) {
      const relative = path.relative(repoRoot, filePath);
      offenders.push({ relative, lines });
    }
  }
}

if (offenders.length > 0) {
  console.error(`Error: ${offenders.length} file(s) exceed ${MAX_LINES} lines:\n`);
  for (const { relative, lines } of offenders.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${lines}  ${relative}`);
  }
  process.exit(1);
}

console.log(`All tracked source files are within ${MAX_LINES} lines.`);
