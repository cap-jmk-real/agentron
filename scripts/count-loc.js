#!/usr/bin/env node
/**
 * Count lines of code in the project (no external packages).
 * Writes badges/loc.json for shields.io endpoint when --write-badge is passed.
 */

const fs = require('fs');
const path = require('path');

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', 'out']);

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function* walk(rootDir) {
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

function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const root = path.resolve(__dirname, '..');
let total = 0;
for (const file of walk(root)) {
  total += countLines(file);
}

console.log(total);

const writeBadge = process.argv.includes('--write-badge');
if (writeBadge) {
  const badgesDir = path.join(root, 'badges');
  if (!fs.existsSync(badgesDir)) fs.mkdirSync(badgesDir, { recursive: true });
  const badge = {
    schemaVersion: 1,
    label: 'lines of code',
    message: formatCount(total),
    color: 'blue',
  };
  fs.writeFileSync(path.join(badgesDir, 'loc.json'), JSON.stringify(badge) + '\n', 'utf8');
}
